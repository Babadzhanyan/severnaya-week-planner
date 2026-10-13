import React from 'react';
import {createRoot} from 'react-dom/client';
import {PlannerProvider} from './state.jsx';
import App from './App.jsx';
import {DEMO_MODE} from './api.js';
import FileScreen from './FileScreen.jsx';
import '../styles.css';
import '../components.css';
import './runtime.css';
import './clarity-shell.css';

class ErrorBoundary extends React.Component {
 constructor(props){super(props);this.state={error:false};}
 static getDerivedStateFromError(){return {error:true};}
 render(){return this.state.error?<div className="app-loading"><h1>Платформа требует повторного открытия</h1><p>Сохранённые условия остаются в этом браузере</p><button className="primary" onClick={()=>location.reload()}>Открыть снова</button></div>:this.props.children;}
}
const fileMode = !DEMO_MODE && new URLSearchParams(location.search).get('data') !== 'demo';
createRoot(document.getElementById('root')).render(<ErrorBoundary>{fileMode ? <FileScreen/> : <PlannerProvider><App/></PlannerProvider>}</ErrorBoundary>);
