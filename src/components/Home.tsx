import { useState } from 'react';
import { ArrowRight, Plus, LogIn, Play, RotateCcw, Users, Layers, Sprout } from 'lucide-react';
import type { RuleConfig, Session } from '../../shared/types';
import { Modal } from './Modal';

export function Home({session,busy,enter,resume,resumeId,error}:{session:Session|null;busy:boolean;enter:(nickname:string,mode:'create'|'join'|'demo',value?:Partial<RuleConfig>|string)=>Promise<unknown>;resume:()=>unknown;resumeId:string;error:string}) {
  const invitation=new URLSearchParams(location.search).get('room')??'';
  const [nickname,setNickname]=useState(session?.nickname??'');
  const [mode,setMode]=useState<'create'|'join'|null>(/^\d{6}$/.test(invitation)?'join':null);
  const [code,setCode]=useState(invitation);
  const [rounds,setRounds]=useState<RuleConfig['rounds']>('A');
  const [seconds,setSeconds]=useState<RuleConfig['turnSeconds']>(30);
  const [showRemaining,setShowRemaining]=useState(true);
  const [allowAutoPlay,setAllowAutoPlay]=useState(true);
  const [allowCounter,setAllowCounter]=useState(true);
  const [resistance,setResistance]=useState(true);
  const valid=Boolean(session||nickname.trim());
  const start=async()=>{
    if(!valid)return;
    const success=await enter(nickname,mode==='join'?'join':'create',mode==='join'?code:{rounds,turnSeconds:seconds,showRemaining,allowAutoPlay,allowCounter,resistance});
    if(success)setMode(null);
  };
  return <main className="home">
    <section className="home-main">
      <div className="home-copy">
        <p className="home-meta">六人 · 三副牌 · 3V3</p>
        <h1>三人一队，<br/>六人开掼<span className="title-dot">。</span></h1>
        <p className="home-description">熟悉的掼蛋，多两份默契。<br/>约上五位好友，这一局，谁也不用旁观。</p>
        <div className="entry-controls">
          <label className="nickname-label" htmlFor="nickname">{session?'本次使用的昵称':'先取个牌桌上的名字'}</label>
          <div className="nickname-input"><span className="initial">{(session?.nickname||nickname||'你').slice(0,1)}</span><input id="nickname" placeholder="输入昵称" maxLength={20} value={session?.nickname??nickname} disabled={!!session} onChange={e=>setNickname(e.target.value)} autoComplete="nickname"/><span className="guest-label">游客</span></div>
          <div className="entry-buttons"><button className="button primary" onClick={()=>setMode('create')} disabled={busy}><Plus size={20}/>创建房间<ArrowRight className="button-tail" size={19}/></button><button className="button secondary" onClick={()=>setMode('join')} disabled={busy}><LogIn size={19}/>加入房间</button></div>
          <button className="text-button demo-link" disabled={busy||!valid} onClick={()=>enter(nickname,'demo')}><Play size={15}/> {busy?'正在连接牌桌…':'先体验一局'} <span>与 5 位体验机器人试玩</span></button>
          {resumeId&&<button className="resume-link" onClick={()=>resume()} disabled={busy}><RotateCcw size={16}/>返回房间 {resumeId}<ArrowRight size={16}/></button>}
        </div>
      </div>
      <div className="home-art" aria-hidden="true">
        <div className="art-orbit"/><div className="art-table"/>
        <div className="art-card back-card"><div className="back-inner"><span>♣</span><b>六人掼蛋</b><small>三人一队</small></div></div>
        <div className="art-card face-card"><span className="art-corner">A<small>♥</small></span><span className="art-heart">♥</span><span className="art-corner flipped">A<small>♥</small></span></div>
        <span className="art-caption">好牌不如好搭档</span><span className="art-line"/>
      </div>
    </section>
    <section className="home-rules" aria-label="六人版的不同"><div><Users size={22}/><p><b>多两个人，多一份配合</b><span>三人组队，隔位而坐</span></p></div><div><Layers size={22}/><p><b>三副牌，依然每人 27 张</b><span>熟悉的牌型，不变的上手方式</span></p></div><div><Sprout size={22}/><p><b>一起争头游，一起升等级</b><span>对方包揽末三名，升 4 级</span></p></div></section>
    {mode&&<Modal title={mode==='create'?'创建好友房':'加入好友房'} onClose={()=>!busy&&setMode(null)}><form onSubmit={e=>{e.preventDefault();void start();}}>
      {!session&&<label className="form-field">你的昵称<input placeholder="输入昵称" maxLength={20} value={nickname} onChange={e=>setNickname(e.target.value)} required/></label>}
      {mode==='join'?<><p className="muted">输入好友分享的 6 位房间号，入座后即可准备。</p><label className="form-field">房间号<input className="room-code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required autoFocus/></label></>:<>
        <p className="muted">三人一队，六人到齐并准备后开始。</p><label className="form-field">本场局数<select value={rounds} onChange={e=>setRounds(e.target.value==='A'?'A':Number(e.target.value) as RuleConfig['rounds'])}><option value="A">打到 A（需打过 A）</option>{[1,2,4,8].map(n=><option key={n} value={n}>{n} 局</option>)}</select></label>
        <label className="form-field">每次出牌时间<select value={seconds} onChange={e=>setSeconds(Number(e.target.value) as RuleConfig['turnSeconds'])}><option value="15">15 秒</option><option value="30">30 秒</option><option value="60">60 秒</option><option value="0">不限时</option></select></label>
        <label className="checkbox-field"><input type="checkbox" checked={showRemaining} onChange={e=>setShowRemaining(e.target.checked)}/>显示其他玩家剩余牌数</label><label className="checkbox-field"><input type="checkbox" checked={allowCounter} onChange={e=>setAllowCounter(e.target.checked)}/>允许使用记牌器</label><label className="checkbox-field"><input type="checkbox" checked={allowAutoPlay} onChange={e=>setAllowAutoPlay(e.target.checked)}/>允许主动托管</label><label className="checkbox-field"><input type="checkbox" checked={resistance} onChange={e=>setResistance(e.target.checked)}/>启用大王抗贡规则</label>
      </>}
      {error&&<p className="error-text" role="alert">{error}</p>}<button className="button primary full-width" disabled={busy||!valid||(mode==='join'&&code.length!==6)}>{busy?'正在进入…':mode==='create'?'创建并入座':'加入房间'}<ArrowRight size={18}/></button>
    </form></Modal>}
  </main>;
}
