"""Синтетические проверки каталога клиентов и денежной сверки."""
import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.files_clients import router, _read_catalog


def money(volume=10, revenue=200, cost=120, logistics=5, margin=70):
    return {'volumeKg':volume,'revenueRub':revenue,'reportedCostRub':cost,'reportedLogisticsRub':logistics,
            'reconciliationRub':revenue-cost-logistics-margin,'marginRub':margin,
            'priceRubKg':revenue/volume if volume>0 else None,'marginRubKg':margin/volume if volume>0 else None,
            'fullCostRubKg':None,'discountRub':None,'logisticsRub':None,'marketCeilingRubKg':None,
            'rowCount':1,'months':['2000-01'],'observedMinPriceRubKg':20,'observedMaxPriceRubKg':20}


def fixture():
    monthly={'period':'2000-01','productKey':'Товар исходный','costProductKey':'Товар исходный','sourceSkuName':'Товар исходный',**money()}
    product={'id':'sku1','name':'Товар','productKey':'Товар исходный','costProductKey':'Товар исходный','sourceSkuName':'Товар исходный','monthly':[monthly],**money()}
    client={'id':'client1','name':'Клиент пример','channels':['Оптовики'],'products':[product],
            'manager':'Служебное имя','managers':['Служебное имя'],'email':'secret@example.test','phone':'+70000000000',
            'sourceRefs':[{'file':'пример.xlsx','sheet':'Данные','cells':'A2:H2','rows':[2]}],**money()}
    datasets=[{'id':identifier,'label':'Клиентский отчёт' if identifier=='clients' else 'Отчёт сделок',
               'summary':{'clientCount':1,'sourceNameCount':1,'managerCount':1,**money()},
               'clients':[copy.deepcopy(client)],'quality':{'cachedFormulaErrorCount':0}} for identifier in ['clients','deals']]
    return {'schemaVersion':1,'period':{'start':'2000-01','end':'2000-01','label':'Январь 2000'},'datasets':datasets,
            'sources':[{'file':'пример.xlsx','sha256':'a'*64,'path':'/private/hidden.xlsx','role':'Пример'}],
            'gaps':[{'id':'cost','message':'Требуется полная себестоимость'}]}


class ClientsCatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.env=patch.dict('os.environ',{'SEVERNAYA_CLIENT_DATA_DIR':self.tmp.name});self.env.start();self.addCleanup(self.env.stop)
        app=FastAPI();app.include_router(router);self.client=TestClient(app)
        self.catalog=fixture();self.save();_read_catalog.cache_clear()

    def save(self):
        Path(self.tmp.name,'real_data_clients.json').write_text(json.dumps(self.catalog,ensure_ascii=False));_read_catalog.cache_clear()

    def pseudonym(self,dataset='clients'):
        # Адрес клиента берется из списка клиентов: исходный id в ответах не появляется.
        return self.client.get('/api/files/clients',params={'dataset':dataset}).json()['clients'][0]['pseudonym']

    def test_two_scopes_and_small_list(self):
        r=self.client.get('/api/files/clients');self.assertEqual(r.status_code,200);d=r.json()
        self.assertEqual(d['datasetId'],'clients');self.assertEqual([s['id'] for s in d['datasets']],['clients','deals'])
        self.assertEqual(d['summary']['revenueRub'],200);self.assertEqual(d['clients'][0]['productCount'],1);self.assertNotIn('products',d['clients'][0])
        self.assertEqual(d['clients'][0]['pseudonym'],'К-001');self.assertNotIn('name',d['clients'][0]);self.assertNotIn('sourceRefs',d['clients'][0])
        self.assertEqual(self.client.get('/api/files/clients?dataset=deals').json()['datasetId'],'deals')

    def test_detail_exact_key_and_month(self):
        d=self.client.get(f'/api/files/clients/{self.pseudonym("deals")}?dataset=deals').json();p=d['client']['products'][0]
        self.assertEqual(p['costProductKey'],'Товар исходный');self.assertEqual(p['monthly'][0]['period'],'2000-01');self.assertEqual(p['monthly'][0]['reconciliationRub'],5)
        self.assertEqual(p['label'],'Товар');self.assertNotIn('name',p);self.assertEqual(d['client']['pseudonym'],'К-001');self.assertNotIn('name',d['client']);self.assertNotIn('sourceRefs',d['client'])

    def test_private_fields_excluded(self):
        for url in ['/api/files/clients',f'/api/files/clients/{self.pseudonym()}']:
            data=self.client.get(url).text
            for secret in ['secret@example.test','+70000000000','Служебное имя','Клиент пример','пример.xlsx','/private/','"managers"','"managerCount"','"name"','"sourceRefs"','client1','"clientId"']:self.assertNotIn(secret,data)

    def test_missing_env_404(self):
        with patch.dict('os.environ',{},clear=True):self.assertEqual(self.client.get('/api/files/clients').status_code,404)

    def test_bundled_disabled(self):
        with patch.dict('os.environ',{'SEVERNAYA_CLIENT_DATA_DIR':'bundled'}):self.assertEqual(self.client.get('/api/files/clients').status_code,404)

    def test_unknown_selection(self):
        self.assertEqual(self.client.get('/api/files/clients?dataset=other').status_code,422);self.assertEqual(self.client.get('/api/files/clients/missing').status_code,404)
        self.assertEqual(self.client.get('/api/files/clients/client1').status_code,404)

    def test_explicit_unknowns(self):
        c=self.client.get(f'/api/files/clients/{self.pseudonym()}').json()['client']
        for k in ['fullCostRubKg','discountRub','logisticsRub','marketCeilingRubKg']:self.assertIsNone(c[k])

    def test_missing_unknown_invalid(self):
        del self.catalog['datasets'][0]['clients'][0]['fullCostRubKg'];self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_nonfinite_invalid(self):
        self.catalog['datasets'][0]['summary']['revenueRub']=float('nan');self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_nonfinite_optional_field_invalid(self):
        self.catalog['datasets'][0]['clients'][0]['logisticsCoverage']={'share':float('inf')};self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_total_tamper_invalid(self):
        self.catalog['datasets'][0]['summary']['volumeKg']+=1;self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_reported_cost_rate_matches_money_and_positive_volume(self):
        for rate in (999,True):
            self.catalog=fixture();self.catalog['datasets'][0]['clients'][0]['reportedCostRubKg']=rate
            self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)
        self.catalog=fixture();self.catalog['datasets'][0]['clients'][0]['reportedCostRubKg']=12
        self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,200)
        for dataset in self.catalog['datasets']:
            client=dataset['clients'][0];product=client['products'][0]
            for record in (dataset['summary'],client,product,product['monthly'][0]):
                record.update(money(0,0,0,0,0),reportedCostRubKg=0)
        self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_duplicate_client_invalid(self):
        ds=self.catalog['datasets'][0];ds['clients'].append(copy.deepcopy(ds['clients'][0]));ds['summary']['clientCount']=2;self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_duplicate_product_invalid(self):
        c=self.catalog['datasets'][0]['clients'][0];c['products'].append(copy.deepcopy(c['products'][0]));self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_wrong_exact_product_invalid(self):
        self.catalog['datasets'][0]['clients'][0]['products'][0]['costProductKey']='Общий товар';self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_monthly_tamper_invalid(self):
        self.catalog['datasets'][0]['clients'][0]['products'][0]['monthly'][0]['reportedCostRub']+=1;self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_duplicate_month_invalid(self):
        p=self.catalog['datasets'][0]['clients'][0]['products'][0];p['monthly'].append(copy.deepcopy(p['monthly'][0]));self.save();self.assertEqual(self.client.get('/api/files/clients').status_code,503)

    def test_negative_and_zero_volume(self):
        for volume in [-2,0]:
            self.catalog=fixture()
            for ds in self.catalog['datasets']:
                c=ds['clients'][0];p=c['products'][0];m=p['monthly'][0]
                for r in [ds['summary'],c,p,m]:r.update(money(volume,-10,-5,0,-5));r['observedMinPriceRubKg']=None;r['observedMaxPriceRubKg']=None
            self.save();result=self.client.get('/api/files/clients');self.assertEqual(result.status_code,200);self.assertIsNone(result.json()['summary']['priceRubKg'])

    def test_gzip_source(self):
        raw=Path(self.tmp.name,'real_data_clients.json');Path(str(raw)+'.gz').write_bytes(gzip.compress(raw.read_bytes()));raw.unlink();self.assertEqual(self.client.get('/api/files/clients').status_code,200)

    def test_file_refresh(self):
        self.assertEqual(self.client.get('/api/files/clients').status_code,200);self.catalog['datasets'][0]['clients'][0]['channels']=['Розница'];self.save()
        refreshed=self.client.get('/api/files/clients').json()['clients'][0];self.assertEqual(refreshed['channels'],['Розница']);self.assertNotIn('name',refreshed)
