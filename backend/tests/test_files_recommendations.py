"""Ценовые сигналы проверяются на синтетическом клиентском каталоге."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.files_recommendations import router, _read
from backend.files_clients import router as clients_router, _read_catalog
from backend.tests.test_files_clients import fixture as clients_fixture, money


def catalog_fixture():
    catalog = clients_fixture()
    for dataset in catalog["datasets"]:
        original = dataset["clients"][0]
        clients = []
        for index, (volume, price) in enumerate(((1000, 180), (5000, 210), (5000, 230)), 1):
            client = copy.deepcopy(original)
            client["id"] = f"client{index}"
            refs = [{"file": "пример.xlsx", "sheet": "Продажи", "rows": [index + 1]}]
            product = client["products"][0]
            for record in (client, product, product["monthly"][0]):
                record.update(money(volume, volume * price, volume * 150, volume * 5, volume * (price - 155)))
                record.update(sourceRefs=copy.deepcopy(refs), observedMinPriceRubKg=price, observedMaxPriceRubKg=price)
            clients.append(client)
        dataset["clients"] = clients
        totals = [sum(client[key] for client in clients) for key in ("volumeKg", "revenueRub", "reportedCostRub", "reportedLogisticsRub", "marginRub")]
        dataset["summary"].update(money(*totals), clientCount=3, sourceNameCount=3, rowCount=3)
    return catalog


def fixture():
    signal = {"period":"2000-01", "channel":"Оптовики", "sourceRow":2, "priceRubKg":180,
              "referencePriceRubKg":220, "observedPeerMinRubKg":210, "observedPeerMaxRubKg":230,
              "peerClients":2, "peerVolumeKg":10000, "focalVolumeKg":1000, "scenarioRub":40000,
              "peerSourceRows":[3,4], "status":"Гипотеза: условия требуют подтверждения"}
    product = {"productId":"sku1", "costProductKey":"Товар исходный", "historicalSignals":[signal],
               "sourceRefs":[{"file":"/private/пример.xlsx","sheet":"Продажи","cells":"A:Z","rows":[2]}],
               "requirements":["demand"]}
    datasets = []
    for identifier in ("clients", "deals"):
        clients = []
        for index in range(1, 4):
            selected = identifier == "clients" and index == 1
            item = copy.deepcopy(product)
            item["sourceRefs"][0]["rows"] = [index + 1]
            item["historicalSignals"] = [copy.deepcopy(signal)] if selected else []
            clients.append({"clientId": f"client{index}", "products": [item],
                            "priorityGroup": 2 if selected else 3,
                            "action": "Проверить условия поставок", "requirements": ["demand"],
                            "historicalReviewRub": 40000 if selected else None})
        datasets.append({"id": identifier, "historicalSignalRows": 1 if identifier == "clients" else 0, "clients": clients})
    return {"schemaVersion":1,"sourceWorkbookSha256":"a"*64,"datasets":datasets,
            "priceMethod":"Гипотеза: средневзвешенная цена других клиентов",
            "boundsBasis":"Потолок спроса требует подтверждения","requirements":{"demand":"Требуется подтверждение спроса"}}


class RecommendationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.env=patch.dict('os.environ',{'SEVERNAYA_CLIENT_DATA_DIR':self.tmp.name});self.env.start();self.addCleanup(self.env.stop)
        Path(self.tmp.name,'next_stage_clients').mkdir()
        self.catalog=catalog_fixture()
        Path(self.tmp.name,'real_data_clients.json').write_text(json.dumps(self.catalog))
        self.data=fixture();self.save();_read_catalog.cache_clear()
        app=FastAPI();app.include_router(router);app.include_router(clients_router);self.client=TestClient(app)

    def save(self):
        Path(self.tmp.name,'next_stage_clients','recommendations_by_client.json').write_text(json.dumps(self.data));_read.cache_clear()

    def pseudonym(self, dataset='clients'):
        # Порядок списка совпадает с синтетическим каталогом: первый клиент набора – client1.
        return self.client.get('/api/files/clients', params={'dataset': dataset}).json()['clients'][0]['pseudonym']

    def get(self, dataset='clients', **params):
        return self.client.get('/api/files/recommendations', params={'dataset': dataset, 'pseudonym': self.pseudonym(dataset), **params})

    def signal(self):
        return self.data['datasets'][0]['clients'][0]['products'][0]['historicalSignals'][0]

    def test_exact_response_and_no_combined_potential(self):
        response=self.get(productId='sku1');self.assertEqual(response.status_code,200);data=response.json()
        signal=data['products'][0]['bestSignal']
        self.assertEqual(data['label'],'Гипотеза исторического периода');self.assertEqual(data['signalCount'],1)
        self.assertEqual(signal['priceGapRubKg'],40);self.assertEqual(signal['scenarioRub'],40000)
        self.assertIsNone(data['marketCeilingRubKg']);self.assertIsNone(data['confirmedProfitRub'])
        self.assertEqual(data['historicalReviewRub'],40000);self.assertNotIn('/private/',response.text)
        self.assertNotIn('clientId',data);self.assertNotIn('client1',response.text)

    def test_client_summary_preserves_scope_and_unknowns(self):
        for params in ({}, {'productId':'sku1'}):
            result=self.get(**params).json()
            self.assertEqual(result['priorityGroup'],2)
            self.assertEqual(result['historicalReviewRub'],40000)
            self.assertEqual(result['action'],'Проверить условия поставок')
            self.assertEqual(result['requirements'],['Требуется подтверждение спроса'])
            self.assertIn('по всем продуктам и месяцам',result['historicalReviewBasis'])
        self.assertIsNone(self.get(dataset='deals').json()['historicalReviewRub'])

    def test_client_summary_rejects_invalid_priority_amount_and_requirements(self):
        for key,value in [('priorityGroup',True),('priorityGroup',0),('priorityGroup',5),('action',' '),
                          ('historicalReviewRub',40001),('historicalReviewRub',None),('requirements',['unknown'])]:
            with self.subTest(key=key,value=value):
                self.data=fixture();self.data['datasets'][0]['clients'][0][key]=value;self.save()
                self.assertEqual(self.get().status_code,503)
        self.data=fixture();self.data['datasets'][1]['clients'][0]['historicalReviewRub']=0;self.save()
        self.assertEqual(self.get().status_code,503)

    def test_scopes_stay_separate(self):
        data=self.get(dataset='deals').json();self.assertEqual(data['signalCount'],0);self.assertEqual(data['products'],[])

    def test_missing_env_and_file(self):
        # Каталог не подключен: маршрут отвечает 404 до проверки псевдонима, поэтому список клиентов здесь не читается.
        params={'pseudonym':'К-001'}
        with patch.dict('os.environ',{},clear=True):self.assertEqual(self.client.get('/api/files/recommendations',params=params).status_code,404)
        with patch.dict('os.environ',{'SEVERNAYA_CLIENT_DATA_DIR':'bundled'}):self.assertEqual(self.client.get('/api/files/recommendations',params=params).status_code,404)
        Path(self.tmp.name,'next_stage_clients','recommendations_by_client.json').unlink();self.assertEqual(self.get().status_code,404)

    def test_unknown_or_cross_product_404(self):
        self.assertEqual(self.client.get('/api/files/recommendations',params={'pseudonym':'К-999'}).status_code,404)
        self.assertEqual(self.client.get('/api/files/recommendations',params={'pseudonym':'client1'}).status_code,422)
        self.assertEqual(self.get(productId='other').status_code,404)

    def test_query_path_and_scope_rejected(self):
        self.assertEqual(self.client.get('/api/files/recommendations',params={'dataset':'other','pseudonym':self.pseudonym()}).status_code,422)
        self.assertEqual(self.get(productId='../secret').status_code,422)

    def test_formula_tamper_503(self):
        self.signal()['scenarioRub']+=1;self.save();self.assertEqual(self.get().status_code,503)

    def test_thresholds_validate_independently(self):
        for key,value in [('focalVolumeKg',999),('peerVolumeKg',9999),('peerClients',1),('referencePriceRubKg',199),('priceRubKg',float('nan'))]:
            with self.subTest(key=key):
                self.data=fixture();self.signal()[key]=value;self.save();self.assertEqual(self.get().status_code,503)

    def test_key_month_source_validation(self):
        for key,value in [('period','2000-02'),('sourceRow',3),('sourceRow',999999),
                          ('peerSourceRows',[3,3]),('peerSourceRows',[]),('peerSourceRows',[3]),
                          ('peerSourceRows',[3,999999]),('peerSourceRows',[2,3])]:
            self.data=fixture();self.signal()[key]=value;self.save();self.assertEqual(self.get().status_code,503)
        self.data=fixture();self.data['datasets'][0]['clients'][0]['products'][0]['costProductKey']='Чужой товар';self.save();self.assertEqual(self.get().status_code,503)

    def test_peer_rows_require_the_same_product_and_month(self):
        original=copy.deepcopy(self.catalog)
        for change in ('product','period'):
            self.catalog=copy.deepcopy(original)
            product=self.catalog['datasets'][0]['clients'][1]['products'][0]
            if change=='product':
                product['id']='sku2'
                self.data['datasets'][0]['clients'][1]['products'][0]['productId']='sku2'
            else:
                product['months']=['2000-02'];product['monthly'][0]['period']='2000-02'
            Path(self.tmp.name,'real_data_clients.json').write_text(json.dumps(self.catalog));_read_catalog.cache_clear()
            self.save();self.assertEqual(self.get().status_code,503)
            self.data=fixture()

    def test_stale_catalog_or_incomplete_scope_503(self):
        self.data['sourceWorkbookSha256']='b'*64;self.save();self.assertEqual(self.get().status_code,503)
        self.data=fixture();self.data['datasets'][0]['clients']=[];self.save();self.assertEqual(self.get().status_code,503)

    def test_duplicate_and_signal_count(self):
        self.data['datasets'][0]['historicalSignalRows']=2;self.save();self.assertEqual(self.get().status_code,503)
        self.data['datasets'][0]['clients'][0]['products'][0]['historicalSignals'].append(copy.deepcopy(self.signal()));self.save();self.assertEqual(self.get().status_code,503)

    def test_errors_sanitize_source(self):
        self.signal()['period']='/private/hidden';self.save();response=self.get()
        self.assertEqual(response.status_code,503);self.assertNotIn('/private/',response.text)
