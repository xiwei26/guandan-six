import { useState } from 'react';
import { Club, BookOpen, Trophy, X, Wifi, WifiOff, SlidersHorizontal } from 'lucide-react';
import { Home } from './components/Home';
import { Table } from './components/Table';
import { History, Rules, Settings } from './components/Info';
import { useGame } from './useGame';
export default function App() {
  const game=useGame();
  const [info,setInfo]=useState<'rules'|'history'|'settings'|null>(null);
  return <div className={`app-shell ${game.room?'in-room':''}`}><header className="app-header"><a className="brand" href="/" onClick={e=>{if(game.room)e.preventDefault();}}><span className="brand-mark"><Club size={23} strokeWidth={1.7}/></span><b>六人掼蛋</b><span className="brand-separator"/><small>好友相聚，开一局</small></a><nav>{game.room?<span className={`connection ${game.connection}`}>{game.connection==='online'?<Wifi size={14}/>:<WifiOff size={14}/>}<span>{game.connection==='online'?'已连接':game.connection==='connecting'?'重连中…':'连接已断开'}</span></span>:null}<button className="text-button" onClick={()=>setInfo('rules')}><BookOpen size={16}/><span>玩法说明</span></button><button className="text-button" onClick={()=>setInfo('history')}><Trophy size={16}/><span>我的战绩</span></button><button className="text-button" onClick={()=>setInfo('settings')}><SlidersHorizontal size={16}/><span>设置</span></button></nav></header>
    {game.error&&<div className="error-banner" role="alert"><span>{game.error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={()=>game.setError('')}><X size={16}/></button></div>}
    {game.room&&game.session?<Table room={game.room} session={game.session} busy={game.busy} connection={game.connection} action={game.action} report={game.report}/>:<Home session={game.session} busy={game.busy} enter={game.enter} resume={game.resume} resumeId={game.resumeId} error={game.error}/>}
    <footer className="app-footer"><span><i/>六人 · 三副牌 · 同一份热闹</span><span>Web 开发版 <span className="footer-dot">·</span> 规则 6P_V1</span></footer>
    {info==='rules'&&<Rules onClose={()=>setInfo(null)}/>}{info==='history'&&<History session={game.session} onClose={()=>setInfo(null)}/>}{info==='settings'&&<Settings onClose={()=>setInfo(null)}/>}
  </div>;
}
