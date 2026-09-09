import { useEffect, useState } from 'react';
import { Trophy, BookOpen, Volume2 } from 'lucide-react';
import type { HistoryEntry, Session, StatsSummary } from '../../shared/types';
import { request } from '../api';
import { playSound, setSoundEnabled, soundEnabled } from '../audio';
import { Modal } from './Modal';
export function Rules({onClose}:{onClose:()=>void}) {
  return <Modal title="六人版，30 秒了解" onClose={onClose} wide><p className="modal-intro">会玩普通掼蛋，就会玩六人掼蛋。</p><div className="rule-list">
    <section><span>01</span><div><h3>六个人，三人一队</h3><p>座位按蓝、橙交替排列。相邻是对手，隔位是队友；你的两个队友有相同的队伍颜色。</p></div></section>
    <section><span>02</span><div><h3>三副牌，每人还是 27 张</h3><p>共 162 张，三张红桃级牌都是逢人配。单张、对子、三张、三带二、顺子、三连对、钢板，都是熟悉的牌型。</p></div></section>
    <section><span>03</span><div><h3>炸弹看张数，同花顺排在中间</h3><p>默认 12 炸 ＞ … ＞ 6 炸 ＞ 同花顺 ＞ 5 炸 ＞ 4 炸 ＞ 普通牌。逢人配不能变成大小王，本版不设混合王炸。</p></div></section>
    <section><span>04</span><div><h3>前三同队，最高升 3 级</h3><p>头游所在队获胜。前三同队升 3 级，前二同队升 2 级，其他升 1 级。打到 A 模式还需成功打过 A。</p></div></section>
  </div><details className="rules-detail"><summary>接风、贡还贡与操作说明</summary><p>玩家出完后，若最后一手无人压，顺时针最近的仍有手牌队友接风；无队友时交给下一位未出完玩家。</p><p>根据成绩进行单贡、双贡或三贡，从败队末位起对应胜队前位。贡最大的非逢人配牌，还 10 以下非级牌；没有小牌时还最小非逢人配牌。</p><p>单贡方持有至少两张大王可抗贡；多贡时败队合计三张大王，全队抗贡。抗贡由上局头游首出。</p><p>点击或横向滑动选择手牌，「提示」循环推荐。自由首出不能不出。时间到按配置托管：跟牌优先不出，首出尽量保留炸弹和逢人配。</p></details><button className="button primary full-width" onClick={onClose}>明白了，入座开掼</button></Modal>;
}
export function History({session,onClose}:{session:Session|null;onClose:()=>void}) {
  const [entries,setEntries]=useState<HistoryEntry[]|null>(null);const [stats,setStats]=useState<StatsSummary|null>(null);const [error,setError]=useState('');
  useEffect(()=>{if(!session){setEntries([]);setStats(null);return;}let active=true;
    Promise.all([request<{history:HistoryEntry[]}>('/api/history',session),request<{stats:StatsSummary}>('/api/stats',session)])
      .then(([history,summary])=>{if(!active)return;setEntries(history.history);setStats(summary.stats);})
      .catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};},[session]);
  return <Modal title="我的战绩" onClose={onClose} wide>{error?<p className="error-text">{error}</p>:entries===null?<p className="muted">正在读取战绩…</p>:entries.length===0?<div className="empty-state"><Trophy size={40}/><h3>第一局，从这里开始</h3><p>完整打一局后，这里会记下你与牌友的成绩。</p><button className="button secondary" onClick={onClose}>返回大厅</button></div>:<>
    {stats&&<div className="stats-grid" aria-label="战绩统计"><div><b>{stats.rounds}</b><span>总场次</span></div><div><b>{stats.winRate}%</b><span>胜率</span></div><div><b>{stats.firstRate}%</b><span>头游率</span></div><div><b>{stats.sweeps}</b><span>三连冠</span></div><div><b>{stats.biggestBomb||'—'}</b><span>最大炸弹</span></div><div><b>{stats.rooms}</b><span>好友局</span></div></div>}
    <div className="history-list">{entries.map(entry=><article key={`${entry.roomId}-${entry.round}`}><div><b>房间 {entry.roomId} · 第 {entry.round} 局</b><span>{new Date(entry.at).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div><p><span className={`team-text ${entry.winner}`}>{entry.winner==='A'?'蓝':'橙'}队胜 · 升 {entry.upgrade} 级</span><span>头游：{entry.order[0]?.nickname}</span><span>{entry.biggestBomb?`最大炸弹 ${entry.biggestBomb} 张`:'无炸弹'}</span></p></article>)}</div></>}<p className="fine-print"><BookOpen size={14}/>仅记录当前身份参与的完整牌局，胜率与头游率按已记录的场次计算。</p></Modal>;
}
export function Settings({onClose}:{onClose:()=>void}) {
  const [sound,setSound]=useState(soundEnabled);
  return <Modal title="设置" onClose={onClose}><p className="modal-intro">只保留会影响这一局体验的开关。</p><label className="checkbox-field"><input type="checkbox" checked={sound} onChange={e=>{setSound(e.target.checked);setSoundEnabled(e.target.checked);if(e.target.checked)playSound('turn');}}/><Volume2 size={15}/>对局音效（出牌、炸弹、结算提示）</label><p className="muted">音效使用浏览器合成音，不加载音频文件。出牌倒计时、托管、记牌器等规则由创建房间的房主设置。</p><button className="button primary full-width" onClick={onClose}>完成</button></Modal>;
}
