import type { CSSProperties, PointerEvent } from 'react';
import type { Card as CardType, Rank } from '../../shared/types';
const suits={spade:'♠',heart:'♥',club:'♣',diamond:'♦',joker:'✦'};
export const cardName=(card:CardType)=>`${{spade:'黑桃',heart:'红桃',club:'梅花',diamond:'方块',joker:''}[card.suit]}${card.rank==='BJ'?'大王':card.rank==='SJ'?'小王':card.rank}`;
export function Card({card,level,selected=false,onPointerDown,onPointerEnter,style,small=false}:{card:CardType;level?:Rank;selected?:boolean;onPointerDown?:(e:PointerEvent<HTMLButtonElement>)=>void;onPointerEnter?:()=>void;style?:CSSProperties;small?:boolean}) {
  const red=card.suit==='heart'||card.suit==='diamond'||card.rank==='BJ';
  const wild=card.suit==='heart'&&card.rank===level;
  const inside=<><span className="card-corner"><b>{card.rank==='BJ'?'大':card.rank==='SJ'?'小':card.rank}</b><span>{suits[card.suit]}</span></span><span className="card-pip">{card.suit==='joker'?'王':suits[card.suit]}</span>{wild&&<span className="wild-tag">配</span>}</>;
  const className=`playing-card ${red?'red':''} ${selected?'selected':''} ${small?'small':''} ${wild?'wild':''}`;
  return onPointerDown?<button type="button" className={className} style={style} aria-label={cardName(card)} aria-pressed={selected} data-card-id={card.id} onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();e.currentTarget.click();}}} onClick={e=>{if(e.detail===0)onPointerDown(e as unknown as PointerEvent<HTMLButtonElement>);}}>{inside}</button>:<div className={className} style={style} aria-label={cardName(card)}>{inside}</div>;
}
