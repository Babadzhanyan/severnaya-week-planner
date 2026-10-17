// Единицы и мощности для интерфейса: перевод массы и времени, паспорт ячейки, карточка ресурса.
// Паритет с backend/units.py проверяют tests/capacity-units.test.mjs и backend/tests/test_units.py.
export const KG_IN_T=1000;
export const HIGH_LOAD_PCT=90;
export const STATUS=Object.freeze({
 source:'Сохраненный расчет файла',
 training:'Учебный пример',
 noData:'Нет данных',
 confirm:'Требуется подтверждение',
 over:'Превышение мощности',
 high:'Высокая загрузка',
 reserve:'Резерв мощности'
});

const finite=value=>typeof value==='number'&&Number.isFinite(value);
function number(value,name){if(!finite(value))throw new RangeError(`${name}_invalid`);return value;}
function positive(value,name){const result=number(value,name);if(result<=0)throw new RangeError(`${name}_invalid`);return result;}
function text(value,name){if(typeof value!=='string'||!value.trim())throw new TypeError(`${name}_required`);return value.trim();}

// Загрузка в процентах: поток / мощность × 100 в одной физической базе. Пустая мощность дает null.
export function loadPercent(flow,capacity){
 if(flow==null||capacity==null)return null;
 number(flow,'flow');number(capacity,'capacity');
 return capacity>0?flow/capacity*100:null;
}

// Статус загрузки по тем же порогам, что у строк мощности: выше мощности, выше 90 %, резерв.
export function loadStatus(flow,capacity){
 if(flow==null||capacity==null)return STATUS.noData;
 number(flow,'flow');number(capacity,'capacity');
 if(flow-capacity>1e-6)return STATUS.over;
 if(capacity<=0)return STATUS.reserve;
 return flow/capacity*100>HIGH_LOAD_PCT?STATUS.high:STATUS.reserve;
}

export function toT(kg){return number(kg,'kg')/KG_IN_T;}
export function toKg(t){return number(t,'t')*KG_IN_T;}

// Суточное значение в недельное: число рабочих дней берется из подтвержденного календаря.
export function dayToWeek(valuePerDay,workingDays){return number(valuePerDay,'day')*positive(workingDays,'working_days');}
export function weekToDay(valuePerWeek,workingDays){return number(valuePerWeek,'week')/positive(workingDays,'working_days');}

// Подпись рабочих дней недели. Число дней передает контракт; значения по умолчанию (например, 7) нет.
// Статус из контракта («гипотеза, принята заказчиком») попадает в подпись: до подтверждения действует «Требуется подтверждение».
export const WORKING_DAYS_UNCONFIRMED=`${STATUS.confirm}: число рабочих дней недели не задано`;
export function workDaysWord(count){const last=count%10,two=count%100;return last===1&&two!==11?'рабочий день':last>=2&&last<=4&&(two<12||two>14)?'рабочих дня':'рабочих дней';}
// ponytail: только целые дни; среднюю неделю (309 / 52 = 5,9) подпись покажет как «не задано», добавить подпись среднего, когда контракт его задаст
export function workingDaysLabel(days,status){
 if(!Number.isInteger(days)||days<=0)return WORKING_DAYS_UNCONFIRMED;
 const word=`${days} ${workDaysWord(days)}`;
 const text=typeof status==='string'?status.trim():'';
 if(text.toLowerCase().startsWith('подтвержд'))return word;
 const basis=text.split(',')[0].trim().toLowerCase();
 return !basis||basis===STATUS.confirm.toLowerCase()?`${STATUS.confirm}: ${word}`:`${STATUS.confirm}: ${word}, ${basis}`;
}

// Паспорт ячейки книги: значение, единица, физическая база, точка взвешивания, период, календарь, правило перевода.
export function unitPassport(cell,value,unit,base,period,calendar,rule){
 let passport;
 try{
  passport={
   sourceCell:{sheet:text(cell.sheet,'sheet'),cells:text(cell.cells,'cells')},
   value:value==null?null:number(value,'value'),
   unit:text(unit,'unit'),
   physicalBase:text(base.physicalBase,'physicalBase'),
   weighingPoint:text(base.weighingPoint,'weighingPoint'),
   period:text(period,'period'),
   calendar:text(calendar,'calendar'),
   conversionRule:text(rule,'rule')
  };
 }catch{
  throw new TypeError('passport_incomplete');
 }
 passport.status=passport.value===null?STATUS.noData:STATUS.source;
 return passport;
}

// Строка карточки ресурса: числитель, знаменатель, процент, единица, период, ячейки-источники, статус.
export function resourceCard(flow,capacity,unit,period,sourceCells,status){
 if(!Array.isArray(sourceCells)||!sourceCells.length)throw new TypeError('source_cells_required');
 return {
  numerator:flow,
  denominator:capacity,
  percent:loadPercent(flow,capacity),
  unit:text(unit,'unit'),
  period:text(period,'period'),
  sourceCells:sourceCells.map(cell=>({...cell})),
  status:status||loadStatus(flow,capacity)
 };
}
