export const DEFAULTS=Object.freeze({routeId:'level_1',cutInputKg:1000,priceChangePct:0,packagingChangePct:0,feetStaffDelta:0,liverStaffDelta:0,cuttingNetHoursDelta:0});
export const FILE_INPUTS_KEY='severnaya.files.inputs.v1';
// Паузы перед повторными попытками первого запроса: сервер после холодного запуска отвечает не сразу.
export const COLD_START_RETRY_MS=Object.freeze([2000,4000]);
const routes=['level_1','level_2_leg','level_2_back_thigh','level_3','level_4'];
const limits={cutInputKg:[0,10000000],priceChangePct:[-100,100],packagingChangePct:[-100,100],feetStaffDelta:[0,30,true],liverStaffDelta:[0,20,true],cuttingNetHoursDelta:[0,8]};
export function validFileInputs(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(DEFAULTS).length&&routes.includes(value.routeId)&&Object.entries(limits).every(([key,[min,max,integer]])=>typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=min&&value[key]<=max&&(!integer||Number.isInteger(value[key])));
}
export function loadFileInputs(storage){
 try{const entry=JSON.parse((storage??globalThis.localStorage)?.getItem(FILE_INPUTS_KEY)||'null');if(entry?.version===1&&validFileInputs(entry.inputs))return {...entry.inputs};}catch{}
 return {...DEFAULTS};
}
export function saveFileInputs(inputs,storage){
 if(!validFileInputs(inputs))return false;
 try{const target=storage??globalThis.localStorage;if(!target)return false;target.setItem(FILE_INPUTS_KEY,JSON.stringify({version:1,inputs}));return true;}catch{return false;}
}
