import React,{useLayoutEffect,useRef,useSyncExternalStore} from 'react';

const h=React.createElement;

// Справка на одном экране: семь шагов работы с неделей. Открывается кнопкой «?», клавишами «?» и F1; при входе не появляется.
// Текст без персональных данных и без расчетных чисел: клиенты указываются кодом вида К-NNN.
export const HELP_STEPS=[
  ['Внести заказы','Откройте раздел «Ввод заказов» и внесите строку заказа: день, клиента, товар, зону, объем и цену. Клиента указывайте кодом вида К-NNN, без фамилии и контактов.'],
  ['Проверить план','В разделе «План недели» смотрите статус: «В норме» значит, что план укладывается в условия, «Риск» требует решения.'],
  ['Сохранить вариант','В блоке решения раздела «План недели» нажмите «Сохранить гипотезу». В блоке появится отметка «Сохранена».'],
  ['Сравнить варианты','В разделе «Варианты» сравните планы недели на одинаковых условиях: вклад, выполнимость и загрузку мощностей.'],
  ['Распечатать','Откройте нужный экран и выберите печать в браузере: Cmd+P на Mac или Ctrl+P в Windows.'],
  ['Отправить файл','Откройте версию недели в шапке (на экранах, кроме плана) и нажмите «Скачать версию». Файл передайте коллеге.'],
  ['Как вернуться','Выберите раздел в строке меню или нажмите «Северная» в шапке, чтобы открыть обзор. Справка открывается кнопкой «?».'],
];

let shown=false;
const listeners=new Set();
const emit=()=>listeners.forEach(listener=>listener());
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const isShown=()=>shown;
export function openOnboarding(){shown=true;emit();}
function closeOnboarding(){shown=false;emit();}

export function Onboarding({onOpenData}){
  const open=useSyncExternalStore(subscribe,isShown);
  const ref=useRef(null),opener=useRef(null);
  useLayoutEffect(()=>{
    if(!open)return;
    opener.current=document.activeElement;
    ref.current?.focus();
    return()=>{const target=opener.current;requestAnimationFrame(()=>{if(target?.isConnected)target.focus();else document.querySelector('.nav-button.active')?.focus();});};
  },[open]);
  if(!open)return null;
  // Клавиши не доходят до навигации по разделам под окном; Tab удерживается внутри окна.
  const onKeyDown=event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();closeOnboarding();return;}
    if(event.key==='Tab'){
      const items=[...ref.current.querySelectorAll('button:not(:disabled)')],first=items[0],tail=items.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();tail.focus();}
      else if(!event.shiftKey&&document.activeElement===tail){event.preventDefault();first.focus();}
    }
  };
  const finish=()=>{closeOnboarding();onOpenData?.();};
  return h('div',{className:'onboarding-overlay',onMouseDown:event=>{if(event.target===event.currentTarget)closeOnboarding();}},
    h('section',{ref,className:'onboarding',role:'dialog','aria-modal':'true','aria-labelledby':'onboarding-title',tabIndex:-1,onKeyDown},
      h('h2',{id:'onboarding-title'},'Как работать с неделей'),
      h('ol',{className:'onboarding-steps'},HELP_STEPS.map(([title,text])=>h('li',{key:title},h('strong',null,title),h('p',null,text)))),
      h('div',{className:'onboarding-actions'},
        h('button',{type:'button',className:'secondary',onClick:closeOnboarding},'Закрыть'),
        h('button',{type:'button',className:'primary',onClick:finish},'Перейти к вводу заказов'))));
}
