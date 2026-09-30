import {compareCombination,findHints,parseCombination,sortCards} from '../shared/cards';
import type {Card,CombinationType,Rank,RuleConfig} from '../shared/types';
export type HandGroup={ids:string[];label:string;type:CombinationType;rank:number};
export function groupCards(cards:Card[],level:Rank,rules:RuleConfig):HandGroup {
  const play=parseCombination(cards,level,rules);
  if(!play)throw new Error('这些牌不能组成合法牌型，请重新选择');
  return {ids:sortCards(cards,level).map(c=>c.id),label:play.label,type:play.type,rank:play.rank};
}
/** Greedy disjoint groups: preserve bombs first; no optimal-strategy guarantee. */
export function arrangeHand(hand:Card[],level:Rank,rules:RuleConfig):HandGroup[]{
  let rest=sortCards(hand,level);const groups:HandGroup[]=[];
  const priority={kingBomb:10,bomb:9,jokerBomb:8,straightFlush:7,twoTriples:6,threePairs:6,straight:5,fullHouse:4,triple:3,pair:2,single:1};
  while(rest.length){const choices=findHints(rest,null,level,rules);
    choices.sort((a,b)=>priority[b.type]-priority[a.type]||b.size-a.size||a.rank-b.rank);
    const group=groupCards(choices[0]?.cards??[rest[0]],level,rules);groups.push(group);
    const used=new Set(group.ids);rest=rest.filter(c=>!used.has(c.id));
  }return groups;
}
export function reconcileGroups(groups:HandGroup[],hand:Card[],level:Rank,rules:RuleConfig):HandGroup[]{
  const remaining=new Map(hand.map(c=>[c.id,c]));const result:HandGroup[]=[];
  for(const group of groups){const cards:Card[]=[];for(const id of group.ids){const c=remaining.get(id);if(c){cards.push(c);remaining.delete(id);}}
    if(!cards.length)continue;
    if(parseCombination(cards,level,rules))result.push(groupCards(cards,level,rules));
    else result.push(...cards.map(c=>groupCards([c],level,rules)));
  }
  result.push(...sortCards([...remaining.values()],level).map(c=>groupCards([c],level,rules)));return result;
}
export function manualGroup(groups:HandGroup[],hand:Card[],ids:string[],level:Rank,rules:RuleConfig):HandGroup[]{
  const unique=new Set(ids),cards=hand.filter(c=>unique.has(c.id));
  if(cards.length!==unique.size)throw new Error('手牌已变化，请重新选牌');
  const group=groupCards(cards,level,rules);
  return [group,...reconcileGroups(groups,hand.filter(c=>!unique.has(c.id)),level,rules)];
}
const BOMBS:CombinationType[]=['bomb','straightFlush','jokerBomb','kingBomb'];
const strength=(group:HandGroup)=>({type:group.type,rank:group.rank,size:group.ids.length,cards:[],label:group.label});
/** Display order only: bombs strongest first on the far left, other groups keep their order. */
export function displayGroups(groups:HandGroup[],rules:RuleConfig):HandGroup[]{
  const bombs=groups.filter(group=>BOMBS.includes(group.type));
  bombs.sort((a,b)=>compareCombination(strength(b),strength(a),rules));
  return [...bombs,...groups.filter(group=>!BOMBS.includes(group.type))];
}
const NUMERALS=['','一','二','三','四','五','六','七','八','九','十','十一','十二'];
/** Display name for a combination; bombs read 四炸, 五炸 … instead of the engine's "4 炸". */
export function patternName(type:CombinationType,size:number,label:string):string{
  return type==='bomb'?`${NUMERALS[size]}炸`:label;
}
/** Short pattern tag shown on arranged groups of more than three cards. */
export function groupTag(group:HandGroup):string|null{
  return group.ids.length<=3?null:patternName(group.type,group.ids.length,group.label);
}
