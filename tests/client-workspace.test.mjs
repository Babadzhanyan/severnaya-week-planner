import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
let checks=0;
const same=(actual,expected,message)=>{checks++;assert.deepEqual(actual,expected,message);};
const productKey=(dataset='clients',client='client1',product='product1')=>JSON.stringify([dataset,client,product]);
const draftKey=(period='2026-03',dataset='clients',client='client1',product='product1')=>JSON.stringify([productKey(dataset,client,product),period]);
const emptyTerms={price:null,cost:'',logistics:'',deductions:'',margin:''};
const fresh={version:1,dataset:'clients',selectedIds:{},productIds:{},periods:{},drafts:{}};

try{
 const {readClientStore,CLIENT_STORAGE}=await server.ssrLoadModule('/src/ClientScreen.jsx');
 const read=value=>readClientStore({getItem:key=>{assert.equal(key,CLIENT_STORAGE);return JSON.stringify(value);}});
 const draft=value=>read({version:1,drafts:{[draftKey()]:value}}).drafts[draftKey()];
 same(CLIENT_STORAGE,'severnaya-clients-v1','Рабочее место использует собственный ключ хранилища');
 for(const raw of [null,'','{','undefined'])same(readClientStore({getItem:()=>raw}),fresh,'Пустое или повреждённое хранилище открывает исходное состояние');
 same(readClientStore({getItem(){throw new Error('Доступ ограничен');}}),fresh,'Ошибка доступа сохраняет рабочее исходное состояние');
 for(const value of [null,[],true,7,'строка',{}, {version:0},{version:2},{version:'1'}])same(read(value),fresh,'Восстановление требует объекта версии 1');
 for(const dataset of ['clients','deals'])same(read({version:1,dataset}).dataset,dataset,'Выбор контура восстанавливается');
 for(const dataset of ['other','',null,[],1])same(read({version:1,dataset}).dataset,'clients','Чужой контур получает исходный выбор');
 same(read({version:1,query:'секрет',arbitrary:true}),fresh,'Посторонние поля остаются за пределами рабочего состояния');

 const longest='a'.repeat(100),tooLong='a'.repeat(101);
 same(read({version:1,selectedIds:{clients:longest,deals:'client_2-A',other:'client3'}}).selectedIds,
      {clients:longest,deals:'client_2-A'},'Каждый допустимый контур сохраняет отдельного клиента');
 for(const value of ['',tooLong,'../client','клиент',null,3,{},[]])same(read({version:1,selectedIds:{clients:value}}).selectedIds,{},'Идентификатор клиента проходит проверку формы и длины');
 same(read({version:1,productIds:{'clients/client1':'product1','deals/client1':'','clients/client2':longest,'other/client1':'product2','clients/../client':'product3','clients/client3/extra':'product4'}}).productIds,
      {'clients/client1':'product1','deals/client1':'','clients/client2':longest},'Выбор товара привязан к контуру и клиенту; пустой выбор сохраняется');
 for(const value of [tooLong,'../product',null,0,{},[]])same(read({version:1,productIds:{'clients/client1':value}}).productIds,{},'Повреждённый выбор продукта очищается');
 for(const field of ['selectedIds','productIds','periods','drafts'])for(const value of [null,[],true,'строка'])same(read({version:1,[field]:value}),fresh,'Раздел рабочего места требует объекта');

 const invalidProductKeys=['{',JSON.stringify(null),JSON.stringify({dataset:'clients'}),JSON.stringify(['clients','client1']),JSON.stringify(['clients','client1','product1','extra']),productKey('other'),productKey('clients','../client'),productKey('clients','client1',tooLong)];
 for(const key of invalidProductKeys){
  same(read({version:1,periods:{[key]:'2026-03'}}).periods,{},'Период требует полного ключа продукта');
  same(read({version:1,drafts:{[JSON.stringify([key,'2026-03'])]:{price:'200'}}}).drafts,{},'Условия требуют полного ключа продукта');
 }
 for(const period of ['', '2026-01','2026-12'])same(read({version:1,periods:{[productKey()]:period}}).periods,{[productKey()]:period},'Месяц или весь период восстанавливается');
 for(const period of ['2026-00','2026-13','2026-1','2026-03-01','26-03',null,3]){
  same(read({version:1,periods:{[productKey()]:period}}).periods,{},'Месяц проходит проверку календарного формата');
  same(read({version:1,drafts:{[JSON.stringify([productKey(),period])]:{price:'200'}}}).drafts,{},'Условия требуют допустимого периода');
 }
 for(const key of ['{',JSON.stringify([productKey()]),JSON.stringify([productKey(),'2026-03','extra']),JSON.stringify({product:productKey(),period:'2026-03'})])same(read({version:1,drafts:{[key]:{price:'200'}}}).drafts,{},'Ключ условий содержит продукт и период');
 for(const value of [null,[],3,'строка'])same(read({version:1,drafts:{[draftKey()]:value}}).drafts,{},'Условия требуют объекта полей');

 same(draft({}),emptyTerms,'Пропуски сохраняют исходные пустые значения');
 same(draft({price:null,cost:null,logistics:null,deductions:null,margin:null}),emptyTerms,'Пустые значения сохраняют точную исходную цену и пустые затраты');
 for(const value of ['','  ','0','0.0']){
  const values=Object.fromEntries(Object.keys(emptyTerms).map(field=>[field,value]));
  same(draft(values),values,'Явный ноль и очищенное поле восстанавливаются отдельно');
 }
 same(draft({price:'1000000',cost:'1000000',logistics:'1000000',deductions:'1000000',margin:'99.9'}),
      {price:'1000000',cost:'1000000',logistics:'1000000',deductions:'1000000',margin:'99.9'},'Верхние границы денежных полей и маржи включены');
 same(draft({price:'159.2221490755123',cost:'130.5',logistics:'10',deductions:'0',margin:'30',other:'999'}),
      {price:'159.2221490755123',cost:'130.5',logistics:'10',deductions:'0',margin:'30'},'Точность строк сохраняется; набор полей ограничен договором');
 for(const field of Object.keys(emptyTerms))for(const value of [-1,0,1,true,{},[], '-1','NaN','Infinity','1e309',field==='margin'?'100':'1000000.01']){
  same(draft({[field]:value})[field],emptyTerms[field],`${field}: повреждённое число получает исходное пустое значение`);
 }
 same(draft({margin:'99.91'}).margin,'','Доля маржи ограничена 99,9%');

 const contexts=[draftKey(''),draftKey('2026-02'),draftKey('2026-03'),draftKey('2026-03','deals'),draftKey('2026-03','clients','client2'),draftKey('2026-03','clients','client1','product2')];
 const values=Object.fromEntries(contexts.map((key,index)=>[key,{price:String(200+index),cost:String(100+index),logistics:'0',deductions:'',margin:'10'}]));
 const store={version:1,dataset:'deals',selectedIds:{clients:'client2',deals:'client1'},productIds:{'clients/client1':'product2','clients/client2':'product1','deals/client1':'product1'},periods:{[productKey()]:'2026-02',[productKey('deals')]:'2026-03',[productKey('clients','client2')]:'',[productKey('clients','client1','product2')]:'2026-03'},drafts:values};
 same(new Set(contexts).size,6,'Год, месяцы, контуры, клиенты и продукты образуют шесть независимых контекстов');
 same(read(store),store,'Все выбранные контексты восстанавливаются с собственными значениями');
 same(read(read(store)),store,'Повторное сохранение и чтение сохраняет контексты');
 const restored=read(store);restored.drafts[contexts[0]].price='999';
 same(read(store).drafts[contexts[0]].price,'200','Повторное чтение создаёт самостоятельное рабочее состояние');
 console.log(`Клиентское рабочее место: ${checks} проверок пройдены`);
}finally{await server.close();}
