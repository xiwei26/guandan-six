import { canBeat,cardStrength,findCombinations,isWildcard,sortCards } from '../shared/cards';
import type { Card,Rank,RoomView,RuleConfig } from '../shared/types';
const SUITS={spade:'♠',heart:'♥',club:'♣',diamond:'♦',joker:'✦'};
const NAMES={spade:'黑桃',heart:'红桃',club:'梅花',diamond:'方块',joker:''};
export const PLACES=['头游','二游','三游','四游','五游','末游'];
export function cardView(card:Card,level:Rank,selected:string[]=[]) {
  return {...card,label:card.rank==='BJ'?'大':card.rank==='SJ'?'小':card.rank,symbol:SUITS[card.suit],
    name:NAMES[card.suit]+(card.rank==='BJ'?'大王':card.rank==='SJ'?'小王':card.rank),
    red:card.suit==='heart'||card.suit==='diamond'||card.rank==='BJ',wild:isWildcard(card,level),selected:selected.indexOf(card.id)>=0};
}
export function handRows(hand:Card[],level:Rank,selected:string[],mode:'rank'|'suit') {
  const cards=sortCards(hand,level,mode).map(c=>cardView(c,level,selected));
  return [cards.slice(0,14),cards.slice(14)].filter(row=>row.length).map((cards,index)=>({id:index,cards:cards.map((c,i)=>({...c,left:cards.length>1?i*100/(cards.length-1):0}))}));
}
export function validReturnCards(hand:Card[],level:Rank):Card[] {
  const low=hand.filter(c=>Number(c.rank)>=2&&Number(c.rank)<10&&c.rank!==level);
  if(low.length)return low;
  const normal=hand.filter(c=>!isWildcard(c,level));const pool=normal.length?normal:hand;
  const min=Math.min(...pool.map(c=>cardStrength(c,level)));return pool.filter(c=>cardStrength(c,level)===min);
}
export function selectionStatus(room:RoomView,selected:string[]) {
  const me=room.players.find(p=>p.seat===room.mySeat)!;
  const mine=room.status==='playing'&&room.currentTurnSeat===room.mySeat&&!me.finishRank;
  const cards=room.hand.filter(c=>selected.includes(c.id));
  const combination=findCombinations(cards,room.currentLevel,room.rules).find(c=>canBeat(c,room.lastPlay,room.rules));
  const donation=room.tribute.find(t=>t.from===room.mySeat&&!t.given);
  const repayment=room.tribute.find(t=>t.to===room.mySeat&&t.given&&!t.returned);
  const canReturn=!!repayment&&selected.length===1&&validReturnCards(room.hand,room.currentLevel).some(c=>c.id===selected[0]);
  return {mine,canPlay:!!mine&&!!combination,canPass:!!mine&&!!room.lastPlay,canTribute:!!donation||canReturn,
    tributeLabel:donation?'确认进贡':repayment?'确认还贡':'等待交换',
    selectionText:repayment?'选择一张 10 以下非级牌还贡':donation?'进贡最大的非逢人配牌':selected.length?combination?`已选 ${cards.length} 张 · ${combination.label}`:'所选牌型无效，或无法压过上一手':'点击或滑动选牌，也可以使用提示'};
}
export function tableView(room:RoomView,selected:string[],sort:'rank'|'suit') {
  const me=room.players.find(p=>p.seat===room.mySeat)!;
  const actor=room.players.find(p=>p.seat===room.currentTurnSeat);
  const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A','SJ','BJ'];
  return {
    room,me,host:me.userId===room.hostId,waiting:room.status==='waiting',playing:room.status==='playing',tribute:room.status==='tribute',ended:room.status==='settlement'||room.status==='finished',
    roundText:room.rules.rounds==='A'?'打到 A':`${room.rules.rounds} 局`,readyCount:room.players.filter(p=>p.ready).length,
    allReady:room.players.length===6&&room.players.every(p=>p.ready),canShuffle:room.players.every(p=>!p.ready),demo:room.players.some(p=>p.bot),
    seats:Array.from({length:6},(_,i)=>{
      const seat=i+1,p=room.players.find(p=>p.seat===seat);
      return {seat,relative:(seat-room.mySeat+6)%6,team:seat%2?'A':'B',occupied:!!p,nickname:p?`${p.nickname}${p.seat===room.mySeat?' · 你':''}`:'等待好友',initial:p?p.nickname.slice(0,1):'+',
        host:p?.userId===room.hostId,ready:!!p?.ready,active:room.status==='playing'&&seat===room.currentTurnSeat,done:!!p?.finishRank,offline:!!p&&!p.connected&&!p.bot,
        detail:!p?`${seat} 号位`:room.status==='waiting'?p.ready?'已准备':'未准备':p.finishRank?PLACES[p.finishRank-1]:`${p.remainingCards===null?'牌数隐藏':p.remainingCards+' 张'}${p.bot?' · 机器人':p.autoPlay?' · 托管':''}`,
        pass:room.passSeats.includes(seat),low:p?.remainingCards!==null&&p?.remainingCards!==undefined&&p.remainingCards<=5};
    }),
    rows:handRows(room.hand,room.currentLevel,selected,sort),played:room.lastPlay?.cards.map(c=>cardView(c,room.currentLevel))??[],
    lastLabel:room.lastPlay?`${room.players.find(p=>p.seat===room.lastPlaySeat)?.nickname} · ${room.lastPlay.label}`:'',
    turnLabel:room.status==='tribute'?'贡还贡阶段':me.finishRank?`你已获得${PLACES[me.finishRank-1]}`:actor?.seat===me.seat?'轮到你出牌':`等待 ${actor?.nickname??'牌友'}`,
    message:room.messages[room.messages.length-1]??'',
    exchanges:room.tribute.map(t=>({...t,fromName:room.players.find(p=>p.seat===t.from)?.nickname,toName:room.players.find(p=>p.seat===t.to)?.nickname,label:t.returned?'已完成':t.given?'待还贡':'待进贡'})),
    ranking:(room.settlement?.order??[]).map((seat,i)=>{const p=room.players.find(p=>p.seat===seat);return {seat,rank:i+1,name:p?.nickname??'已离席',team:p?.team,place:PLACES[i]};}),
    counter:ranks.map(rank=>({rank,label:rank==='SJ'?'小王':rank==='BJ'?'大王':rank,count:Math.max(0,(rank==='SJ'||rank==='BJ'?3:12)-(room.playedCounts[rank]??0)-room.hand.filter(c=>c.rank===rank).length)})),
    ...selectionStatus(room,selected)
  };
}
export const DEFAULT_OPTIONS:Partial<RuleConfig>={rounds:'A',turnSeconds:30,showRemaining:true,allowAutoPlay:true,allowCounter:true,resistance:true};
