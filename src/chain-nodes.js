// Узлы цепочки и мощность участков. Каждая операция принадлежит одному участку, массы сохраняют базу источника.
export const CHAIN_NODES = [
 {id:'procurement',name:'Закупки',stages:[]},
 {id:'feed',name:'Комбикорм',stages:[]},
 {id:'breeders',name:'Родительское стадо',stages:[]},
 {id:'hatchery',name:'Инкубатор',stages:[]},
 {id:'growing',name:'Выращивание',stages:[]},
 {id:'slaughter',name:'Убой и потрошение',stages:['receiving','hanging','slaughter','plucking','evisceration']},
 {id:'cooling',name:'Охлаждение',stages:['water_cooling','carcass_cold_store','sorting']},
 {id:'cutting',name:'Разделка',stages:['cutting','breast_fillet','thigh_fillet']},
 {id:'processing',name:'Переработка',stages:[]},
 {id:'packaging',name:'Упаковка',stages:['bulk_carcass_pack','individual_carcass_pack','ishida_pack']},
 {id:'storage',name:'Склад',stages:[]},
 {id:'sales',name:'Продажи',stages:[]},
 {id:'byproducts',name:'Субпродукты',stages:['liver','byproduct_pack','feet_pack']},
];

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const loadOf=row=>finite(row?.load)?row.load:finite(row?.demand)&&finite(row?.capacity)?row.capacity>0?row.demand/row.capacity:row.demand===0?0:null:null;
const over=row=>finite(row?.headroom)?row.headroom<-1e-6:finite(row?.capacity)&&finite(row?.demand)&&row.demand>row.capacity+1e-6;
const toneOf=row=>over(row)?'bad':loadOf(row)>=.9?'watch':loadOf(row)!==null?'ok':'unknown';

export function getNodeCapacity(node, capacity){
 const rows=node.stages.map(id=>capacity?.rows?.find(row=>row.id===id)).filter(Boolean);
 const known=rows.filter(row=>finite(row.demand)&&finite(row.capacity));
 const worst=known.reduce((chosen,row)=>!chosen||over(row)&&!over(chosen)||(over(row)===over(chosen)&&(loadOf(row)??Infinity)>(loadOf(chosen)??Infinity))?row:chosen,null);
 return {rows,worst,knownCount:known.length,requiredCount:node.stages.length-known.length,load:worst?loadOf(worst):null,tone:worst?toneOf(worst):'unknown',missing:node.stages.filter(id=>!rows.some(row=>row.id===id))};
}

// Укрупненные узлы Визуальной спецификации (шесть). Каждый из 13 узлов CHAIN_NODES входит ровно в один укрупненный узел.
// Соответствие сделано по названиям узлов из иллюстрации; сопоставление «Холод» и «Заморозка и склад» требует подтверждения технолога.
export const CHAIN_MACRO = [
 {id:'bird',name:'Птица',icon:'bird',nodeIds:['procurement','feed','breeders','hatchery','growing'],branches:[]},
 {id:'slaughter',name:'Убой и охлаждение',icon:'slaughter',nodeIds:['slaughter','cooling'],branches:[]},
 {id:'carcass',name:'Тушка / разделка',icon:'cutting',nodeIds:['cutting','processing','byproducts'],branches:[
  {id:'whole',name:'Целая тушка',nodeIds:[],next:'packaging'},
  {id:'cut',name:'Разделка',nodeIds:['cutting']},
  {id:'processed',name:'Переработка',nodeIds:['processing']},
  {id:'byproducts',name:'Субпродукты',nodeIds:['byproducts']},
  {id:'deboning',name:'Механическая обвалка',nodeIds:['byproducts']},
 ]},
 {id:'packing',name:'Упаковка',icon:'packing',nodeIds:['packaging'],branches:[]},
 {id:'cold',name:'Холод',icon:'cold',nodeIds:['storage'],branches:[]},
 {id:'shipping',name:'Отгрузка',icon:'truck',nodeIds:['sales'],branches:[]},
];

// Названия операций по переделам карты мощности (src/FileScreen.jsx: STAGE_SHORT). «Упаковка ног» сохраняется до подтверждения соответствия лапам или окорочку.
const OPERATION = {
 receiving:{name:'Приемка',massBasis:'Живой вес в эквиваленте общего потока'},
 hanging:{name:'Навеска',massBasis:'Живой вес в эквиваленте общего потока'},
 slaughter:{name:'Убой',massBasis:'Живой вес в эквиваленте общего потока'},
 plucking:{name:'Ощипка',massBasis:'Живой вес в эквиваленте общего потока'},
 evisceration:{name:'Потрошение',massBasis:'Масса потрохов, выход от расчетного поголовья'},
 water_cooling:{name:'Охлаждение',massBasis:'Живой вес в эквиваленте общего потока'},
 carcass_cold_store:{name:'Холодильник',massBasis:'Живой вес в эквиваленте общего потока'},
 sorting:{name:'Сортировка',massBasis:'Живой вес в эквиваленте общего потока'},
 cutting:{name:'Разделка',massBasis:'Готовые позиции с признаком разделки STORK / MEYN'},
 breast_fillet:{name:'Филе грудки',massBasis:'Готовые позиции филе грудки'},
 thigh_fillet:{name:'Филе бедра',massBasis:'Готовые позиции филе бедра'},
 bulk_carcass_pack:{name:'Тушка в ящик',massBasis:'Готовая тушка с признаком валовой упаковки'},
 individual_carcass_pack:{name:'Тушка в пакет',massBasis:'Готовая тушка с признаком индивидуальной упаковки'},
 ishida_pack:{name:'Упаковка ISHIDA',massBasis:'Готовые позиции с признаком упаковки ISHIDA'},
 liver:{name:'Ливер',massBasis:'Ливер, 3% от готового потока тушки и разделки'},
 byproduct_pack:{name:'Субпродукты',massBasis:'Индивидуальные субпродукты, 2% от готового потока'},
 feet_pack:{name:'Упаковка ног',massBasis:'Лапы, 4% от готового потока тушки и разделки'},
};
const op=id=>({id,name:OPERATION[id].name,massBasis:OPERATION[id].massBasis,status:'В карте мощности'});

// Полная цепочка из 13 узлов иллюстрации «Цепочка из вложения». Направление связей на иллюстрации не показано:
// links задают соседство без направления, separateFlow отмечает отдельный поток (пунктир на иллюстрации).
export const CHAIN_DETAIL = [
 {id:'procurement',name:'Закупка сырья',macroId:'bird',operations:[],links:['feed'],separateFlow:[],timing:null},
 {id:'feed',name:'Комбикормовый завод',macroId:'bird',operations:[],links:['procurement','breeders','growing'],separateFlow:[],timing:null},
 {id:'breeders',name:'Родительское стадо',macroId:'bird',operations:[],links:['feed','hatchery'],separateFlow:['slaughter'],timing:null},
 {id:'hatchery',name:'Инкубатор',macroId:'bird',operations:[],links:['breeders','growing'],separateFlow:[],timing:null},
 {id:'growing',name:'Выращивание бройлера',macroId:'bird',operations:[],links:['hatchery','feed','slaughter'],separateFlow:[],timing:null},
 {id:'slaughter',name:'Убой и потрошение',macroId:'slaughter',operations:['receiving','hanging','slaughter','plucking','evisceration'].map(op),links:['growing','cooling','byproducts'],separateFlow:['breeders'],timing:null},
 {id:'cooling',name:'Охлаждение и сортировка',macroId:'slaughter',operations:['water_cooling','carcass_cold_store','sorting'].map(op),links:['slaughter','packaging','cutting'],separateFlow:[],timing:null},
 {id:'cutting',name:'Разделка и обвалка',macroId:'carcass',operations:['cutting','breast_fillet','thigh_fillet'].map(op),links:['cooling','processing','byproducts'],separateFlow:[],timing:null},
 {id:'packaging',name:'Упаковка и маркировка',macroId:'packing',operations:['bulk_carcass_pack','individual_carcass_pack','ishida_pack'].map(op),links:['cooling','processing','storage','byproducts'],separateFlow:[],timing:null},
 {id:'processing',name:'Глубокая переработка',macroId:'carcass',operations:[],links:['packaging','cutting'],separateFlow:[],timing:null},
 {id:'storage',name:'Заморозка и склад',macroId:'cold',operations:[],links:['packaging','sales'],separateFlow:[],timing:null},
 {id:'sales',name:'Продажи и отгрузка',macroId:'shipping',operations:[],links:['storage'],separateFlow:[],timing:null},
 {id:'byproducts',name:'Субпродукты и механическая обвалка',macroId:'carcass',operations:['liver','byproduct_pack','feet_pack'].map(op),links:['cutting','packaging','slaughter'],separateFlow:[],timing:null},
];

// Операции из 27 без названия и узла: в репозитории и пакете найдено 17 переделов карты мощности.
// Маршрутная матрица лежит во внешней папке источников (переменная SEVERNAYA_SOURCE_DATA_DIR), поэтому 10 операций требуют подтверждения.
export const CHAIN_DETAIL_PENDING_OPERATIONS = Object.freeze({
 count: 10,
 totalOperations: 27,
 status: 'Требуется подтверждение',
 owner: 'технолог',
});
