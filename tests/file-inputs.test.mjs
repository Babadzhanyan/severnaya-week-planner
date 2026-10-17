import assert from 'node:assert/strict';
import {DEFAULTS,FILE_INPUTS_KEY,validFileInputs,loadFileInputs,saveFileInputs} from '../src/file-inputs.js';
const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
const changed={...DEFAULTS,routeId:'level_4',feetStaffDelta:7,liverStaffDelta:3,cuttingNetHoursDelta:1.5,cutInputKg:1250,priceChangePct:-10};
assert.equal(saveFileInputs(changed,storage),true);
assert.deepEqual(loadFileInputs(storage),changed);
for(const bad of [null,[],{...changed,routeId:'other'},{...changed,cutInputKg:null},{...changed,cutInputKg:'0'},{...changed,priceChangePct:Infinity},{...changed,feetStaffDelta:7.5},{...changed,liverStaffDelta:21},{...changed,cuttingNetHoursDelta:9},{...changed,extra:1}]){
 assert.equal(validFileInputs(bad),false);
 storage.setItem(FILE_INPUTS_KEY,JSON.stringify({version:1,inputs:bad}));
 assert.deepEqual(loadFileInputs(storage),DEFAULTS);
}
for(const value of ['{broken',JSON.stringify({version:2,inputs:changed})]){storage.setItem(FILE_INPUTS_KEY,value);assert.deepEqual(loadFileInputs(storage),DEFAULTS);}
const blocked={getItem(){throw Error();},setItem(){throw Error();}};
assert.deepEqual(loadFileInputs(blocked),DEFAULTS);assert.equal(saveFileInputs(changed,blocked),false);
assert.equal(validFileInputs({...DEFAULTS,cutInputKg:0,priceChangePct:-100,feetStaffDelta:30,liverStaffDelta:20,cuttingNetHoursDelta:8}),true);
assert.equal(saveFileInputs(DEFAULTS,storage),true);assert.deepEqual(loadFileInputs(storage),DEFAULTS);
console.log('Сохранение условий: восстановление, границы, версия, повреждение, null и сброс проверены');
