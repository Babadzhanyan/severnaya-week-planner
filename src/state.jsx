import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {api, DEMO_MODE} from './api.js';
import {clone, n, pathSet, prodName, VIEWS} from './format.js';
import {openOnboarding} from './Onboarding.jsx';
import {DRAFT_KEY, DRAFT_SCHEMA, migrateDraft} from './scenario-state.js';
import {buildVariant, restoreInputs, variantCode} from './scenarios-local.js';
import {addScenario} from './store/weekStore.js';

const Context = createContext(null);
export const usePlanner = () => useContext(Context);
const STORAGE = DRAFT_KEY;
const confirmations = () => ({commercial:false, production:false, finance:false});
// Сценарий: идентификаторы и редакция данных заполняются при сохранении; день и зона ждут подтверждения владельца данных.
function initialState(defaults) {
  return {p:clone(defaults),view:'overview',demandMode:'products',product:'fillet',confirms:confirmations(),approved:null,revision:1,
    request:{quantity:4,price:300,service:0,requestId:'demo-order-1',forecastAbsorption:true},
    roi:{weeks:52,execution:0.7,investment:null,annualOpex:null},client:{volume:10,share:75,price:205,service:15},capacityTab:'scenario',
    scenario:{dataEdition:null,day:null,zone:null,packing:null,client:null,paramsVersion:null,name:'',baseRevision:null},hypothesis:null};
}
function loadState(defaults) {
  let state = initialState(defaults), migration = [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    const old = saved ? null : JSON.parse(localStorage.getItem('severnaya-planner-v3') || 'null');
    const migrated = migrateDraft(saved || old);
    migration = migrated.changedBasis;
    const stored = migrated.state;
    if (stored?.p && typeof stored.p === 'object') state = {...state,...stored,p:{...defaults,...stored.p}};
  } catch { /* Отсутствующий либо поврежденный снимок заменяется начальным примером */ }
  if (migration.length) state.migration = migration;
  state.view = 'overview';
  const hash = location.hash.slice(1);
  if (VIEWS.some(([id]) => id === hash)) state.view = hash;
  if (!VIEWS.some(([id]) => id === state.view)) state.view = 'overview';
  return state;
}
export function PlannerProvider({children}) {
  const [M,setM]=useState(null),[S,setS]=useState(null),[calculation,setCalculation]=useState(null);
  const [busy,setBusy]=useState(true),[operationBusy,setOperationBusy]=useState(false),[error,setError]=useState('');
  const [modal,setModal]=useState(null),[tooltip,setTooltip]=useState(null),[toast,setToast]=useState('');
  const [requestResult,setRequestResult]=useState(null),[retry,setRetry]=useState(0),[hypothesisBusy,setHypothesisBusy]=useState(false);
  const hypothesisLock=useRef(false);
  const toastTimer=useRef(null),generation=useRef(0),stateRef=useRef(S),opGeneration=useRef(0),requestRef=useRef(requestResult);
  stateRef.current=S;requestRef.current=requestResult;
  const notify = text => { setToast(text); clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),3800); };
  useEffect(()=>()=>clearTimeout(toastTimer.current),[]);
  useEffect(()=>{
    const controller=new AbortController();
    api('catalog',undefined,{signal:controller.signal}).then(c=>{setM(c);setS(current=>current||loadState(c.defaults));setError('');}).catch(e=>{if(e.name!=='AbortError'){setError(e.message || 'Требуется соединение с сервером расчетов');setBusy(false);}});
    return()=>controller.abort();
  },[retry]);
  useEffect(()=>{
    if(!S)return;
    try {localStorage.setItem(STORAGE,JSON.stringify({schema:DRAFT_SCHEMA,state:S}));}catch { /* Сеанс остается доступен в памяти React */ }
  },[S]);
  // Перенос черновика сообщает пользователю пересчитанные основания один раз.
  useEffect(()=>{if(!S?.migration?.length)return;notify(`Черновик перенесен. Пересчитаны основания: ${S.migration.join(', ')}`);setS(({migration,...rest})=>rest);},[S?.migration]);
  const calculationKey=S?JSON.stringify([S.p,S.approved,S.roi,S.client]):'';
  useEffect(()=>{
    if(!S||!M)return;
    const current=++generation.current,controller=new AbortController();setBusy(true);setError('');
    const opts={signal:controller.signal};
    const savedParams=S.approved?.params||S.p;
    Promise.all([
      api('evaluate',{params:S.p},opts),
      api('fact',S.approved?{snapshot:S.approved}:{params:S.p},opts),
      api('roi',{params:S.p,options:S.roi},opts),
      api('commercial',{client:S.client},opts),
      S.approved?api('evaluate',{params:savedParams},opts):Promise.resolve(null),
    ]).then(([evaluation,fact,roi,commercial,saved])=>{
      if(current!==generation.current)return;
      const r=evaluation.result,a=evaluation.alternatives;
      setCalculation({r,a,base:a.baseline?.result||r,fact,roi,commercial,savedResult:saved?.result||r});setBusy(false);
    }).catch(e=>{if(current===generation.current&&e.name!=='AbortError'){setError(e.message||'Требуется соединение с сервером расчетов');setBusy(false);}});
    return()=>controller.abort();
  },[calculationKey,M,retry]);
  // Вариант сохраняется только в локальном хранилище браузера (addScenario). Серверная запись сценариев в интерфейсе не вызывается.
  // Повтор того же содержимого возвращает уже сохраненный вариант. Сохранение не ждет подтверждений участников и утверждения.
  async function saveHypothesis(){
    const s=stateRef.current;if(!s||!M||hypothesisLock.current)return;
    if(busy||error||!calculation?.r){notify('Расчет обновляется: сохраните вариант после пересчета');return;}
    hypothesisLock.current=true;setHypothesisBusy(true);
    const route=M.routes?.[s.p.route]?.name||s.p.route;
    const title=(s.scenario?.name||`${prodName(s.product,M)}, ${route}, В${s.revision}`).slice(0,80);
    try{
      const saved=addScenario(await buildVariant(s,calculation.r,{title}));
      if(!saved.ok){notify(saved.errors[0]);return;}
      const code=variantCode(saved.scenario.contentHash);
      setS(cur=>({...cur,scenario:{...cur.scenario,name:title},hypothesis:{label:title,mode:'browser',savedAt:saved.scenario.createdAt,code}}));
      notify(saved.created?`Вариант сохранен в браузере: код ${code}`:`Такой вариант уже сохранен: код ${code}, изменений нет`);
    }catch(e){notify(e.message||'Вариант не удалось подготовить');}
    finally{hypothesisLock.current=false;setHypothesisBusy(false);}
  }
  // Открытие варианта: входы и товар возвращаются в черновик через пересчет. Сохраненный результат остается в варианте,
  // а экран вариантов сравнивает пересчет с сохраненным вкладом и показывает расхождение.
  function openVariant(scenario){
    const s=stateRef.current;if(!s)return;
    let restored;
    try{restored=restoreInputs(scenario);}catch(e){notify(e.message);return;}
    const code=variantCode(scenario.contentHash);
    updateParams(restored.p,{
      product:restored.product??s.product,request:restored.request??s.request,roi:restored.roi??s.roi,client:restored.client??s.client,
      scenario:{...s.scenario,...restored.scenario,name:scenario.title},
      hypothesis:{label:scenario.title,mode:'browser',savedAt:scenario.createdAt,code},
      opened:{id:scenario.id,code},
    });
    notify(`Вариант открыт: код ${code}`);
  }
  function updateParams(params,extra={}) {
    opGeneration.current++;setRequestResult(null);
    setS(s=>({...s,...extra,p:clone(params),confirms:confirmations(),revision:s.revision+1}));
  }
  function changeField(scope,path,value) {
    opGeneration.current++;
    if(scope==='p'||scope==='request')setRequestResult(null);
    // Автоматическое снижение разделки при уменьшении входа сообщается пользователю.
    if(scope==='p'&&path==='totalInput'&&stateRef.current?.p?.cut>value)notify(`Направить в разделку ограничено входом: ${n(value)} т`);
    setS(s=>{
      let updated=pathSet(s[scope],path,value);
      if(scope==='p'){
        if(path==='totalInput')updated.cut=Math.min(updated.cut,value);
        if(path==='route'&&value==='whole')updated.cut=0;
        if(path==='minWhole')updated.orders={...updated.orders,whole:value};
      }
      return {...s,[scope]:updated,...(scope==='p'?{confirms:confirmations(),revision:s.revision+1}:{})};
    });
  }
  function selectRoute(id){const s=stateRef.current,p={...s.p,route:id};if(id==='whole')p.cut=0;else if(p.cut===0)p.cut=Math.min(p.capacity,p.totalInput-p.minWhole);updateParams(p);}
  function setProduct(product){opGeneration.current++;setRequestResult(null);setS(s=>({...s,product}));}
  function setConfirm(id,value){opGeneration.current++;setS(s=>({...s,confirms:{...s.confirms,[id]:value}}));}
  function go(view,demandMode='products'){if(!VIEWS.some(([id])=>id===view))return;setTooltip(null);setModal(null);setS(s=>({...s,view,demandMode:view==='demand'?demandMode:'products'}));history.replaceState(null,'','#'+view);}
  function chooseCandidate(index){const c=calculation?.a.candidates[index];if(c){updateParams(c.params);notify('Вариант выбран. Подтверждения относятся к новым условиям');}}
  function showTooltip(text,target){if(modal)return;const rect=target.getBoundingClientRect();setTooltip({text,x:Math.max(8,Math.min(innerWidth-290,rect.left)),y:rect.bottom+8});}
  function hideTooltip(){setTooltip(null);}
  function download(){const s=stateRef.current;const blob=new Blob([JSON.stringify({status:'Учебный пример',version:s.approved||{params:s.p},exported:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Северная_версия_плана.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function act(action){
    setTooltip(null);
    if(action==='close'){setModal(null);return;}
    if(action==='tour'){setModal(null);setTooltip(null);openOnboarding();return;}
    if(action==='retry'){setRetry(x=>x+1);return;}
    if(action==='scenarios'){go('plan');requestAnimationFrame(()=>{const d=document.getElementById('alternatives');if(d){d.open=true;d.scrollIntoView();}});return;}
    if(action==='edit-request'){setRequestResult(null);return;}
    if(action==='export'){download();return;}
    if(action==='save-hypothesis'){saveHypothesis();return;}
    if(action==='reset'){opGeneration.current++;setRequestResult(null);setS(initialState(M.defaults));setModal(null);notify('Учебный пример восстановлен');return;}
    if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('Используйте полноэкранный режим браузера');}return;}
    if(action==='levers-resources'){setModal({kind:'levers',tab:'resources'});return;}
    if(action==='apply-request'){
      const q=requestRef.current;if(q?.params&&q.canApply===true){updateParams(q.params,{request:{...stateRef.current.request,requestId:'demo-order-'+Date.now()}});notify('Заявка включена в учебный сценарий');}return;
    }
    if(action==='check-request'||action==='approve'){
      if(busy||operationBusy||error)return;
      const version=opGeneration.current,s=clone(stateRef.current);setOperationBusy(true);
      try {
        if(action==='check-request'){
          const q=await api('request',{params:s.p,request:{...s.request,product:s.product}});
          if(version===opGeneration.current){setRequestResult(q);notify('Заявка проверена по корзине и ресурсам');}
        }else{
          const snapshot=await api('snapshot',{params:s.p,confirmations:s.confirms});
          if(version!==opGeneration.current)return;
          if(snapshot?.approved!==true){notify(snapshot.errors?.[0]||'Проверьте условия утверждения');return;}
          setS(current=>({...current,approved:clone(snapshot),approvedLabel:'В'+s.revision,approvedAt:new Date().toISOString()}));notify('Версия В'+s.revision+' сохранена в браузере');
        }
      }catch(e){notify(e.message||'Расчет требует повторного запроса');}finally{setOperationBusy(false);}return;
    }
    setModal({kind:action,tab:action==='sources'?'sources':'main'});
  }
  useEffect(()=>{
    const onHash=()=>{const id=location.hash.slice(1);if(VIEWS.some(([v])=>v===id))setS(s=>s?({...s,view:id,demandMode:'products'}):s);};
    window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash);
  },[]);
  const value={S,M,...(calculation||{}),modal,setModal,toast,tooltip,busy:busy||operationBusy,error,requestResult,changeField,act,go,selectRoute,setProduct,setConfirm,chooseCandidate,notify,showTooltip,hideTooltip,demoMode:DEMO_MODE,hypothesisBusy,openVariant};
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
