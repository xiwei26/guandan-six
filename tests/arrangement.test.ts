import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeHand,manualGroup,reconcileGroups,groupCards,displayGroups,groupTag} from '../game-src/arrangement';
import {createDeck,parseCombination,dealCards,shuffleDeck} from '../shared/cards';
import {DEFAULT_RULES,type Card} from '../shared/types';
function verify(hand:Card[],groups:ReturnType<typeof arrangeHand>){
  assert.deepEqual(groups.flatMap(g=>g.ids).sort(),hand.map(c=>c.id).sort());
  for(const g of groups)assert.ok(parseCombination(g.ids.map(id=>hand.find(c=>c.id===id)!), '2',DEFAULT_RULES));
}
test('auto groups cover each physical card once with valid shapes and preserve six kings',()=>{
  const kings=createDeck().filter(c=>c.suit==='joker');assert.equal(arrangeHand(kings,'2',DEFAULT_RULES)[0].label,'天王炸');
  for(let i=0;i<12;i++)for(const hand of dealCards(shuffleDeck(createDeck()))){const before=JSON.stringify(hand);verify(hand,arrangeHand(hand,'2',DEFAULT_RULES));assert.equal(JSON.stringify(hand),before);}
});
test('manual regrouping removes cards from old groups, rejects invalid groups and reconciles exchanges',()=>{
  const hand=createDeck().filter(c=>['3','4'].includes(c.rank)).slice(0,8);
  const groups=arrangeHand(hand,'2',DEFAULT_RULES),pair=hand.filter(c=>c.rank==='3').slice(0,2).map(c=>c.id);
  const next=manualGroup(groups,hand,pair,'2',DEFAULT_RULES);assert.equal(next[0].label,'对子');verify(hand,next);
  assert.throws(()=>manualGroup(groups,hand,[hand.find(c=>c.rank==='3')!.id,hand.find(c=>c.rank==='4')!.id],'2',DEFAULT_RULES));
  const changed=[...hand.slice(1),createDeck().find(c=>c.rank==='A')!];verify(changed,reconcileGroups(next,changed,'2',DEFAULT_RULES));
});
test('display order puts bombs strongest-first on the left and keeps other groups in place',()=>{
  const deck=createDeck(),pick=(rank:string,count:number,suit?:string)=>deck.filter(c=>c.rank===rank&&(!suit||c.suit===suit)).slice(0,count);
  const pair=groupCards(pick('Q',2),'2',DEFAULT_RULES),fourBomb=groupCards(pick('9',4),'2',DEFAULT_RULES);
  const straight=groupCards([...pick('3',1,'club'),...pick('4',1,'heart'),...pick('5',1,'club'),...pick('6',1,'club'),...pick('7',1,'club')],'2',DEFAULT_RULES);
  const sixBomb=groupCards(pick('3',6),'2',DEFAULT_RULES),flush=groupCards(['8','9','10','J','Q'].flatMap(rank=>pick(rank,1,'spade')),'2',DEFAULT_RULES);
  const ordered=displayGroups([pair,fourBomb,straight,sixBomb,flush],DEFAULT_RULES);
  assert.deepEqual(ordered.map(group=>group.type),['bomb','straightFlush','bomb','pair','straight']);
  assert.deepEqual(ordered.map(group=>groupTag(group)),['六炸','同花顺','四炸',null,'顺子']);
  assert.equal(groupTag(groupCards(pick('K',3),'2',DEFAULT_RULES)),null,'three-card groups stay untagged');
});
