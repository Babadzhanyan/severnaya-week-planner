import React,{useEffect,useState} from 'react';

// Раздел хранит рабочий выбор после первого открытия, пока открыто приложение
export default function RetainedView({active,children}){
 const [visited,setVisited]=useState(active);
 useEffect(()=>{if(active)setVisited(true);},[active]);
 return active||visited?<div className="retained-view" hidden={!active}>{children}</div>:null;
}
