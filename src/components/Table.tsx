import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, Check, Copy, Crown, Lightbulb, Pause, Play, Shuffle, Timer, UserRound, Users, X, ArrowRight, Trophy, RefreshCw } from 'lucide-react';
import type { Combination, GameAction, RoomView, Session } from '../../shared/types';
import { canBeat, cardStrength, findCombinations, isWildcard } from '../../shared/cards';
import { request } from '../api';
import { playSound } from '../audio';
import { Card } from './Card';
import { Hand } from './Hand';
import { Modal } from './Modal';
const ranking=['头游','二游','三游','四游','五游','末游'];
const COUNTER=['2','3','4','5','6','7','8','9','10','J','Q','K','A','SJ','BJ'];
const counterLabel=(rank:string)=>rank==='SJ'?'小王':rank==='BJ'?'大王':rank;
type Props={room:RoomView;session:Session;busy:boolean;connection:string;action:(action:GameAction)=>Promise<unknown>;report:(error:unknown)=>void};
export function Table({room,session,busy,connection,action,report}:Props) {
  const [selected,setSelected]=useState<string[]>([]);
  const [hintIndex,setHintIndex]=useState(0);
  const [hintBusy,setHintBusy]=useState(false);
  const [now,setNow]=useState(Date.now());
  const [copyStatus,setCopyStatus]=useState('');
  const [leaveOpen,setLeaveOpen]=useState(false);
  const [swapping,setSwapping]=useState(false);
  const [swapFrom,setSwapFrom]=useState<number|null>(null);
  const [counterOpen,setCounterOpen]=useState(false);
  const [dealing,setDealing]=useState(false);
  const me=room.players.find(p=>p.userId===session.userId)!;
  const host=room.hostId===session.userId;
  const mine=room.status==='playing'&&room.currentTurnSeat===room.mySeat&&!me.finishRank;
  const waiting=room.status==='waiting';
  const ended=room.status==='settlement'||room.status==='finished';
  const demo=room.players.some(p=>p.bot);
  const canAct=!busy&&connection==='online';
  const selectedCards=useMemo(()=>room.hand.filter(c=>selected.includes(c.id)),[room.hand,selected]);
  const combination=useMemo(()=>findCombinations(selectedCards,room.currentLevel,room.rules).find(c=>canBeat(c,room.lastPlay,room.rules)),[selectedCards,room.currentLevel,room.rules,room.lastPlay]);
  const myTribute=room.tribute.find(t=>t.from===me.seat&&!t.given);
  const myReturn=room.tribute.find(t=>t.to===me.seat&&t.given&&!t.returned);
  const returns=useMemo(()=>{
    const low=room.hand.filter(c=>Number(c.rank)>=2&&Number(c.rank)<10&&c.rank!==room.currentLevel);
    if(low.length)return low;
    const nonWild=room.hand.filter(c=>!isWildcard(c,room.currentLevel));const pool=nonWild.length?nonWild:room.hand;
    const min=Math.min(...pool.map(c=>cardStrength(c,room.currentLevel)));return pool.filter(c=>cardStrength(c,room.currentLevel)===min);
  },[room.hand,room.currentLevel]);
  const counter=useMemo(()=>COUNTER.map(rank=>{
    const total=rank==='SJ'||rank==='BJ'?3:12;
    const mine=room.hand.filter(c=>c.rank===rank).length;
    return {rank,remaining:Math.max(0,total-(room.playedCounts?.[rank]??0)-mine)};
  }),[room.hand,room.playedCounts]);
  const teamFirsts=useMemo(()=>{
    const result={A:0,B:0};
    for(const [userId,count] of Object.entries(room.matchStats?.firsts??{})) {
      const player=room.players.find(p=>p.userId===userId);
      if(player) result[player.team]+=count;
    }
    return result;
  },[room.matchStats,room.players]);
  const handIds=room.hand.map(c=>c.id).join(',');
  useEffect(()=>{setSelected(old=>old.filter(id=>room.hand.some(c=>c.id===id)));},[handIds]);
  const previous=useRef({plays:0,passes:0,round:0,status:'',turn:false});
  useEffect(()=>{
    const before=previous.current;
    if(room.round!==before.round) { if(room.round>0) playSound('deal'); }
    else if((room.status==='settlement'||room.status==='finished')&&before.status!==room.status) playSound('win');
    else if(room.totalPlays>before.plays) playSound(room.lastPlay?.type==='bomb'?'bomb':'play');
    else if(room.passSeats.length>before.passes) playSound('pass');
    else if(mine&&!before.turn) playSound('turn');
    previous.current={plays:room.totalPlays,passes:room.passSeats.length,round:room.round,status:room.status,turn:mine};
  },[room.round,room.status,room.totalPlays,room.passSeats.length,room.lastPlay,mine]);
  const seenRound=useRef<number|null>(null);
  useEffect(()=>{
    if(!room.round) return;
    const first=seenRound.current===null;
    if(seenRound.current===room.round) return;
    seenRound.current=room.round;
    if(first) return;
    setDealing(true);
    const id=setTimeout(()=>setDealing(false),1150);
    return()=>clearTimeout(id);
  },[room.round]);
  useEffect(()=>{setHintIndex(0);},[room.lastPlaySeat,room.totalPlays,handIds]);
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(id);},[]);
  useEffect(()=>{if(!copyStatus)return;const id=setTimeout(()=>setCopyStatus(''),3500);return()=>clearTimeout(id);},[copyStatus]);
  const share=async()=>{
    const url=`${location.origin}/?room=${room.roomId}`;
    try{await navigator.clipboard.writeText(url);setCopyStatus('邀请链接已复制');}catch{setCopyStatus(`分享此地址：${url}`);}
  };
  const hint=async()=>{
    setHintBusy(true);
    try{const result=await request<{hints:Combination[]}>(`/api/rooms/${room.roomId}/hints`,session,{});if(!result.hints.length){setSelected([]);setCopyStatus('没有能压过的牌，可以选择不出');}else{setSelected(result.hints[hintIndex%result.hints.length].cards.map(c=>c.id));setHintIndex(hintIndex+1);}}
    catch(error){report(error);}finally{setHintBusy(false);}
  };
  const play=async()=>{if(await action({type:'play',cardIds:selected}))setSelected([]);};
  const seconds=room.deadline===null?null:Math.max(0,Math.ceil((room.deadline-now)/1000));
  const active=room.players.find(p=>p.seat===room.currentTurnSeat);
  const tributeAction=async()=>{if(await action(myTribute?{type:'tribute'}:{type:'tribute',cardId:selected[0]}))setSelected([]);};
  const seatClick=async(seat:number)=>{
    if(!swapping)return;
    if(swapFrom===null){if(room.players.some(p=>p.seat===seat&&!p.ready))setSwapFrom(seat);return;}
    if(swapFrom===seat){setSwapFrom(null);return;}
    if(await action({type:'swap',seat:swapFrom,target:seat})){setSwapFrom(null);setSwapping(false);}
  };
  return <main className="table-page">
    <div className="room-toolbar"><button className="text-button" onClick={()=>setLeaveOpen(true)}><ArrowLeft size={17}/><span>返回大厅</span></button><div className="room-id">好友房 <b>{room.roomId}</b><span>{room.rules.rounds==='A'?'打到 A':`${room.rules.rounds} 局`}{room.round>0?` · 第 ${room.round} 局`:''}</span></div><div className="toolbar-tools"><button className="text-button" onClick={share}><Copy size={16}/><span>复制邀请</span></button>{room.rules.allowCounter&&room.round>0&&<button className={`text-button ${counterOpen?'active-tool':''}`} onClick={()=>setCounterOpen(!counterOpen)} aria-pressed={counterOpen}><Calculator size={16}/><span>记牌</span></button>}</div></div>
    <div className="table-score"><div className="team-score A"><span className="team-dot"/>蓝队<strong>{room.teamLevels.A}</strong></div><div className="table-status">{waiting?<><Users size={16}/>{room.players.length}/6 人入座</>:<><span className="level-indicator">打 {room.currentLevel}</span><span>{demo?'体验桌 · 5 位机器人':'三人一队，默契上桌'}</span></>}</div><div className="team-score B"><strong>{room.teamLevels.B}</strong>橙队<span className="team-dot"/></div></div>
    <section className={`table-surface ${waiting?'waiting':''}`} aria-label="六人牌桌">
      <div className="felt"><div className="felt-ring"/><div className="felt-brand">六人掼蛋<span>三人一队 · 六人开掼</span></div></div>
      {Array.from({length:6},(_,i)=>i+1).map(seat=>{
        const player=room.players.find(p=>p.seat===seat);const relative=(seat-room.mySeat+6)%6;
        return <div key={seat} className={`seat pos-${relative} ${player?.team??(seat%2?'A':'B')} ${room.status==='playing'&&seat===room.currentTurnSeat?'active':''} ${player?.finishRank?'done':''} ${swapping?'swapping':''} ${swapFrom===seat?'swap-selected':''}`}>
          <button className={`avatar ${!player?'empty':''}`} onClick={()=>swapping?void seatClick(seat):!player?void share():undefined} disabled={!!player&&!swapping || swapping&&!!player?.ready || busy} aria-label={swapping?`选择座位 ${seat}`:player?`${player.nickname}，${player.team==='A'?'蓝':'橙'}队`:`邀请好友加入座位 ${seat}`}>
            {player?<span>{player.nickname.slice(0,1)}</span>:<UserRound size={24}/>}{player?.userId===room.hostId&&<Crown className="host-crown" size={14}/>}{player&&!player.connected&&!player.bot&&<span className="offline-dot"/>}
          </button><div className="seat-name">{player?`${player.nickname}${player.userId===session.userId?' · 你':''}`:'等待好友'}</div>
          <div className={`seat-detail ${player?.remainingCards!==null&&player?.remainingCards!==undefined&&player.remainingCards<=5?'low':''}`}>{player?waiting?player.ready?<><Check size={12}/>已准备</>:'未准备':player.finishRank?ranking[player.finishRank-1]:<>{player.remainingCards===null?'手牌隐藏':`${player.remainingCards} 张`}{player.bot?' · 机器人':player.autoPlay?' · 托管':''}</>:`${seat%2?'蓝':'橙'}队 · ${seat} 号位`}</div>
          {room.passSeats.includes(seat)&&room.status==='playing'&&<span className="pass-bubble">不出</span>}
        </div>;
      })}
      {dealing&&<div className="deal-overlay" aria-hidden="true"><span className="deal-deck"/>{Array.from({length:6},(_,i)=><span key={i} className={`deal-pile pos-${i}`}/>)}<em>发牌中 · 每人 27 张</em></div>}
      <div className="table-center">{waiting?<div className="waiting-center"><span className="table-center-icon"><Users size={26}/></span><h2>{room.players.length<6?'等好友，一起开掼':room.players.every(p=>p.ready)?'人已到齐，准备开掼':'人已到齐，准备一下'}</h2><p>{swapping?swapFrom?`已选 ${swapFrom} 号位，再选目标座位`:'点击一位未准备玩家，再选择目标座位':`已准备 ${room.players.filter(p=>p.ready).length} / 6`}</p><button className="felt-invite" onClick={share}><Copy size={14}/>邀请好友入座</button></div>:room.status==='tribute'?<div className="tribute-center"><h2>{room.tribute.length===3?'三贡':room.tribute.length===2?'双贡':'单贡'} · 交换好牌</h2><div className="tribute-pairs">{room.tribute.map(t=><div key={t.from}><span>{room.players.find(p=>p.seat===t.from)?.nickname}</span><ArrowRight size={14}/><span>{room.players.find(p=>p.seat===t.to)?.nickname}</span><small>{t.returned?'已完成':t.given?'待还贡':'待进贡'}</small></div>)}</div></div>:room.lastPlay?<div className="last-play"><span>{room.players.find(p=>p.seat===room.lastPlaySeat)?.nickname} · {room.lastPlay.label}</span><div className="played-cards">{room.lastPlay.cards.map(card=><Card key={card.id} card={card} level={room.currentLevel} small/>)}</div></div>:<div className="free-lead"><span>{room.tributeResisted?'抗贡成功':''}</span><h2>{mine?'轮到你首出':`${active?.nickname??''} 首出`}</h2><p>{mine?'选一手好牌，打个好开头':'这一手，等一份默契'}</p></div>}</div>
    </section>
    <div className="table-notice" role="status">{copyStatus||room.messages.at(-1)||'蓝色和橙色区分队伍，隔位的两位是你的队友。'}</div>
    {counterOpen&&room.rules.allowCounter&&<div className="counter-panel"><div className="counter-head"><b>记牌器</b><span>场上仍未出现的牌，不含自己的手牌</span></div><div className="counter-grid">{counter.map(item=><span key={item.rank} className={`counter-chip ${item.remaining?'':'empty'}`}><b>{counterLabel(item.rank)}</b><small>{item.remaining}</small></span>)}</div></div>}
    {waiting?<section className="lobby-actions"><div className="lobby-main-buttons"><button className={`button ${me.ready?'secondary':'primary'}`} disabled={!canAct} onClick={()=>action({type:'ready',ready:!me.ready})}>{me.ready?<><X size={17}/>取消准备</>:<><Check size={18}/>我准备好了</>}</button>{host&&<button className="button primary" disabled={!canAct||room.players.length!==6||!room.players.every(p=>p.ready)} onClick={()=>action({type:'start'})}><Play size={17}/>开始游戏</button>}</div>{host&&<div className="host-tools"><button className="text-button" disabled={!canAct||room.players.some(p=>p.ready)} onClick={()=>action({type:'shuffleTeams'})}><Shuffle size={15}/>随机组队</button><button className="text-button" disabled={!canAct} onClick={()=>{setSwapping(!swapping);setSwapFrom(null);}}><RefreshCw size={14}/>{swapping?'结束换座':'调整座位'}</button></div>}<p className="fine-print">{host?'所有人准备后，即可开始。换座前请先取消准备。':'准备后等待房主开始。分享链接，再邀请几位好友。'}</p></section>:<>
      <div className="action-bar"><div className={`turn-description ${mine?'your-turn':''}`}><Timer size={18}/><div><b>{room.status==='tribute'?myTribute?'请确认进贡':myReturn?'请选择还贡牌':'等待贡还贡':me.finishRank?`你已获得${ranking[me.finishRank-1]}`:mine?'轮到你出牌':`等待 ${active?.nickname??'牌友'}`}</b><span>{seconds===null?'不限时':`${seconds} 秒`}{me.autoPlay?' · 托管中':''}</span></div></div>
        <div className="play-buttons">{room.status==='tribute'?<button className="button primary" disabled={!canAct||!(myTribute||(myReturn&&selected.length===1&&returns.some(c=>c.id===selected[0])))} onClick={tributeAction}>{myTribute?'确认进贡':myReturn?'确认还贡':'等待交换'}</button>:<><button className="button secondary" disabled={!mine||!room.lastPlay||!canAct} onClick={()=>action({type:'pass'})}>不出</button><button className="button secondary" disabled={!mine||!canAct||hintBusy} onClick={hint}><Lightbulb size={17}/>{hintBusy?'计算中':'提示'}</button><button className="button primary play-button" disabled={!mine||!combination||!canAct} onClick={play}>出牌<ArrowRight size={17}/></button></>}</div>
        <button className={`auto-button ${me.autoPlay?'enabled':''}`} disabled={!canAct||(!room.rules.allowAutoPlay&&!me.autoPlay)||ended} onClick={()=>action({type:'auto',enabled:!me.autoPlay})}>{me.autoPlay?<Play size={16}/>:<Pause size={16}/>}<span>{me.autoPlay?'取消托管':'托管'}</span></button>
      </div>
      <div className="selection-info">{room.status==='tribute'&&myReturn?'请选择一张 10 以下非级牌；无此类牌时选最小非逢人配牌':selected.length?combination?`已选 ${selected.length} 张 · ${combination.label}`:mine?'所选牌型无效，或不能压过上一手':`已选 ${selected.length} 张`:mine?'点击或滑动选牌，也可以试试「提示」':'可以提前选牌，轮到你时再出牌'}</div>
      <Hand cards={room.hand} level={room.currentLevel} selected={selected} setSelected={setSelected}/>
    </>}
    {ended&&room.settlement&&<Modal title={room.status==='finished'?'本场结束':'本局结算'} onClose={()=>{}} wide dismissible={false}><div className="settlement-hero"><Trophy size={30}/><h3>{room.settlement.winner==='A'?'蓝':'橙'}队获得头游</h3><div className="level-change"><b>{room.settlement.fromLevel}</b><ArrowRight size={24}/><b>{room.settlement.toLevel}</b><span>+{room.settlement.upgrade} 级</span></div><p>{room.settlement.reason}</p></div><ol className="ranking-list">{room.settlement.order.map((seat,index)=>{const p=room.players.find(p=>p.seat===seat);return <li key={seat}><span className="rank-number">{index+1}</span><b>{p?.nickname??'已离席'}{p?.userId===session.userId?' · 你':''}</b><span className={`team-text ${p?.team??'A'}`}>{p?.team==='A'?'蓝':'橙'}队</span><small>{ranking[index]}</small></li>;})}</ol><div className="settlement-summary">{room.status==='finished'?<><span>总局数 {room.matchStats.rounds}</span><span>总出牌 {room.matchStats.totalPlays} 次</span><span>最大炸弹 {room.matchStats.biggestBomb?`${room.matchStats.biggestBomb} 张`:'暂无'}</span><span>头游 蓝 {teamFirsts.A} · 橙 {teamFirsts.B}</span><span>三连冠 蓝 {room.matchStats.sweeps.A} · 橙 {room.matchStats.sweeps.B}</span></>:<><span>本场出牌 {room.totalPlays} 次</span><span>最大炸弹 {room.biggestBomb?`${room.biggestBomb} 张`:'暂无'}</span></>}</div><div className="modal-actions">{room.status==='settlement'&&host?<button className="button primary" disabled={!canAct} onClick={()=>action({type:'next'})}>开始下一局<ArrowRight size={18}/></button>:room.status==='settlement'?<p className="muted">等待房主开始下一局</p>:<button className="button primary" disabled={busy} onClick={()=>action({type:'leave'})}>返回大厅</button>}</div></Modal>}
    {leaveOpen&&<Modal title={waiting?'离开好友房？':'暂时离开牌桌？'} onClose={()=>setLeaveOpen(false)}><p className="muted">{waiting?'离开后将让出当前座位，可以通过房间号再次加入。':'当前牌局会继续，你的座位会保留。可从首页「返回房间」继续；允许托管时会由系统代为操作。'}</p><div className="modal-actions"><button className="button secondary" onClick={()=>setLeaveOpen(false)}>留在牌桌</button><button className="button primary" disabled={busy} onClick={()=>action({type:'leave'})}>确认离开</button></div></Modal>}
  </main>;
}
