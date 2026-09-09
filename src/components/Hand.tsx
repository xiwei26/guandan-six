import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownWideNarrow, RotateCcw } from 'lucide-react';
import { sortCards } from '../../shared/cards';
import type { Card as CardType, Rank } from '../../shared/types';
import { Card } from './Card';
export function Hand({cards,level,selected,setSelected}:{cards:CardType[];level:Rank;selected:string[];setSelected:(ids:string[])=>void}) {
  const [sort,setSort]=useState<'rank'|'suit'>('rank');
  const [compact,setCompact]=useState(()=>window.innerWidth<700);
  const sorted=useMemo(()=>sortCards(cards,level,sort),[cards,level,sort]);
  const drag=useRef<{select:boolean;visited:Set<string>}|null>(null);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  useEffect(()=>{const media=matchMedia('(max-width: 699px)');const change=()=>setCompact(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const visit=(id:string)=>{
    const active=drag.current;if(!active||active.visited.has(id))return;active.visited.add(id);
    const next=active.select?[...new Set([...selectedRef.current,id])]:selectedRef.current.filter(c=>c!==id);selectedRef.current=next;setSelected(next);
  };
  useEffect(()=>{
    const stop=()=>{drag.current=null;};
    const move=(e:PointerEvent)=>{if(!drag.current)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-card-id]');if(target){const id=target.getAttribute('data-card-id');if(id)visit(id);}};
    window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);window.addEventListener('pointermove',move);
    return()=>{window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);window.removeEventListener('pointermove',move);};
  });
  const rows=compact&&sorted.length>14?[sorted.slice(0,14),sorted.slice(14)]:[sorted];
  return <section className="hand-section" aria-label="我的手牌"><div className="hand-heading"><div><b>我的手牌</b><span>{cards.length} 张</span><small>红桃 {level} 为逢人配</small></div><div className="hand-tools"><button className="text-button" onClick={()=>setSort(sort==='rank'?'suit':'rank')}><ArrowDownWideNarrow size={15}/>{sort==='rank'?'按点数':'按花色'}</button><button className="text-button" onClick={()=>setSelected([])} disabled={!selected.length}><RotateCcw size={14}/>清空</button></div></div>
    {cards.length?<div className="hand-cards">{rows.map((row,index)=><div className="hand-row" key={index}>{row.map((card,i)=><Card key={card.id} card={card} level={level} selected={selected.includes(card.id)} style={i?{marginLeft:`min(8px, calc((100% - ${row.length} * var(--card-width)) / ${Math.max(1,row.length-1)}))`}:undefined} onPointerDown={event=>{event.preventDefault();drag.current={select:!selectedRef.current.includes(card.id),visited:new Set()};visit(card.id);if(event.type==='click')drag.current=null;}} onPointerEnter={()=>visit(card.id)}/>)}</div>)}</div>:<div className="hand-empty">你已出完，看看队友的配合。</div>}
  </section>;
}
