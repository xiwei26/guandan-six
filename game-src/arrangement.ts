import {findHints,parseCombination,sortCards} from '../shared/cards';
import type {Card,Rank,RuleConfig} from '../shared/types';
export type HandGroup={ids:string[];label:string};
export function groupCards(cards:Card[],level:Rank,rules:RuleConfig):HandGroup {
  const play=parseCombination(cards,level,rules);
  if(!play)throw new Error('这些牌不能组成合法牌型，请重新选择');
  return {ids:sortCards(cards,level).map(c=>c.id),label:play.label};
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
