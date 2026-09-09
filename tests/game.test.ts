import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, applyAction, createRoom, getRoomView, setConnected, tickGame } from '../server/game.ts';
import { createDeck, findHints, isWildcard, cardStrength } from '../shared/cards.ts';
import { type Card, type GameAction, type GameState, type Rank } from '../shared/types.ts';

function room(rules: Parameters<typeof createRoom>[3] = {}) {
  const state = createRoom('123456','p1','玩家 1',rules);
  for (let i = 2; i <= 6; i++) addPlayer(state,`p${i}`,`玩家 ${i}`);
  return state;
}

function ready(state: GameState) {
  for (const p of state.players) applyAction(state,p.userId,{ type: 'ready', ready: true });
}

function handFixture(ranks: Rank[][], level: Rank = '2') {
  const state = room();
  const pool = createDeck();
  for (const [i,rs] of ranks.entries()) state.players[i].hand = rs.map(rank => {
    const index = pool.findIndex(c => c.rank === rank && !isWildcard(c,level));
    assert.ok(index >= 0, `Fixture has too many ${rank} cards`);
    return pool.splice(index,1)[0];
  });
  state.status = 'playing';
  state.round = 1;
  state.currentLevel = level;
  state.currentTurnSeat = 1;
  state.deadline = 1000;
  return state;
}

function play(state: GameState, seat: number, count = 1) {
  applyAction(state,`p${seat}`,{ type: 'play', cardIds: state.players.find(p => p.seat === seat)!.hand.slice(0,count).map(c => c.id) });
}

function invalidWithoutMutation(state: GameState, userId: string, action: GameAction, pattern?: RegExp) {
  const before = structuredClone(state);
  if (pattern) assert.throws(() => applyAction(state,userId,action),pattern);
  else assert.throws(() => applyAction(state,userId,action));
  assert.deepEqual(state,before);
}

function nearFinish(order: number[], level: Rank = '2') {
  const state = handFixture([['3'],['4'],['5'],['6'],['7'],['8']],level);
  state.finishOrder = order.slice(0,4);
  for (const [i,seat] of state.finishOrder.entries()) {
    state.players[seat - 1].finishRank = i + 1;
    state.players[seat - 1].hand = [];
  }
  state.currentTurnSeat = order[4];
  state.teamLevels.A = level;
  state.teamLevels.B = level;
  return state;
}

test('room enforces fixed rules, six players, host start and readiness; server deals all 162 physical cards', () => {
  assert.throws(() => createRoom('12345','p','名'),/六位/);
  assert.throws(() => createRoom('123456','p','名',{ deckCount: 2 as 3 }),/三副牌/);
  assert.throws(() => createRoom('123456','p','名',{ turnSeconds: -1 as 30 }),/时限/);
  const state = room();
  assert.deepEqual(state.players.map(p => p.team),['A','B','A','B','A','B']);
  invalidWithoutMutation(state,'p1',{ type: 'start' },/全部准备/);
  assert.throws(() => addPlayer(state,'p7','第七人'),/已满/);
  ready(state);
  invalidWithoutMutation(state,'p2',{ type: 'start' },/房主/);
  applyAction(state,'p1',{ type: 'start' });
  assert.equal(state.status,'playing');
  assert.equal(state.round,1);
  assert.ok(state.currentTurnSeat >= 1 && state.currentTurnSeat <= 6);
  assert.ok(state.players.every(p => p.hand.length === 27));
  assert.equal(new Set(state.players.flatMap(p => p.hand.map(c => c.id))).size,162);
  invalidWithoutMutation(state,'p1',{ type: 'start' });
  assert.throws(() => addPlayer(state,'late','迟到'),/开始/);
});

test('only unready seats can swap; a prepared bystander does not prohibit other unready players swapping', () => {
  const state = room();
  applyAction(state,'p1',{ type: 'ready', ready: true });
  invalidWithoutMutation(state,'p1',{ type: 'swap', seat: 1, target: 2 },/准备/);
  invalidWithoutMutation(state,'p1',{ type: 'shuffleTeams' },/准备/);
  applyAction(state,'p1',{ type: 'swap', seat: 2, target: 3 });
  assert.equal(state.players.find(p => p.userId === 'p2')!.team,'A');
  assert.equal(state.players.find(p => p.userId === 'p3')!.seat,2);
  invalidWithoutMutation(state,'p2',{ type: 'swap', seat: 2, target: 4 },/房主/);
  applyAction(state,'p1',{ type: 'ready', ready: false });
  applyAction(state,'p1',{ type: 'shuffleTeams' });
  assert.equal(new Set(state.players.map(p => p.seat)).size,6);
  assert.equal(state.players.filter(p => p.team === 'A').length,3);
});

test('public views contain only the viewer hand, obey count visibility and cannot mutate authoritative state', () => {
  const state = handFixture([['3'],['4'],['5'],['6'],['7'],['8']]);
  state.rules.showRemaining = false;
  const view = getRoomView(state,'p1');
  assert.equal(view.mySeat,1);
  assert.equal(view.players[0].remainingCards,1);
  assert.ok(view.players.slice(1).every(p => p.remainingCards === null));
  assert.ok(view.players.every(p => !('hand' in p)));
  for (const p of state.players.slice(1)) assert.ok(!JSON.stringify(view).includes(p.hand[0].id));
  view.hand.pop();
  view.rules.showRemaining = true;
  view.messages.push('bad client');
  assert.equal(state.players[0].hand.length,1);
  assert.equal(state.rules.showRemaining,false);
  assert.ok(!state.messages.includes('bad client'));
  assert.throws(() => getRoomView(state,'spectator'),/房间/);
});

test('invalid, duplicate, forged, replayed and out-of-turn card actions are atomic', () => {
  const state = handFixture([['3','4'],['5','5'],['6'],['7'],['8'],['9']]);
  invalidWithoutMutation(state,'p2',{ type: 'play', cardIds: [state.players[1].hand[0].id] },/轮到/);
  invalidWithoutMutation(state,'p1',{ type: 'pass' },/首出/);
  invalidWithoutMutation(state,'p1',{ type: 'play', cardIds: [] });
  invalidWithoutMutation(state,'p1',{ type: 'play', cardIds: ['fake'] },/属于/);
  invalidWithoutMutation(state,'p1',{ type: 'play', cardIds: [state.players[0].hand[0].id,state.players[0].hand[0].id] },/重复/);
  invalidWithoutMutation(state,'p1',{ type: 'play', cardIds: state.players[0].hand.map(c => c.id) },/牌型/);
  const used = state.players[0].hand[0].id;
  play(state,1);
  invalidWithoutMutation(state,'p1',{ type: 'play', cardIds: [used] },/轮到/);
  invalidWithoutMutation(state,'p2',{ type: 'play', cardIds: state.players[1].hand.map(c => c.id) },/压过/);
});

test('five passes reset the trick and return free lead to the active last player', () => {
  const state = handFixture([['3','4'],['5'],['6'],['7'],['8'],['9']]);
  play(state,1);
  for (let seat = 2; seat <= 6; seat++) applyAction(state,`p${seat}`,{ type: 'pass' });
  assert.equal(state.currentTurnSeat,1);
  assert.equal(state.lastPlay,null);
  assert.deepEqual(state.passSeats,[]);
});

test('a finishing leader passes wind to the clockwise nearest active teammate', () => {
  const state = handFixture([['3'],['4'],['5'],['6'],['7'],['8']]);
  play(state,1);
  assert.deepEqual(state.finishOrder,[1]);
  for (let seat = 2; seat <= 6; seat++) applyAction(state,`p${seat}`,{ type: 'pass' });
  assert.equal(state.currentTurnSeat,3);
  assert.equal(state.lastPlay,null);
  assert.match(state.messages.at(-1)!,/接风/);
});

test('wind skips finished teammates and falls back clockwise if the whole team has finished', () => {
  const state = handFixture([[],['4'],[],['6'],['3'],['8']]);
  state.finishOrder = [1,3];
  state.players[0].finishRank = 1;
  state.players[2].finishRank = 2;
  state.currentTurnSeat = 5;
  play(state,5);
  for (const seat of [6,2,4]) applyAction(state,`p${seat}`,{ type: 'pass' });
  assert.equal(state.currentTurnSeat,6);
  assert.equal(state.lastPlay,null);
  assert.equal(state.status,'playing');
});

test('round waits for five finishers, assigns the last rank and awards simple +1/+2/+3 levels', () => {
  for (const [order,upgrade] of [ [[1,3,5,2,4,6],3], [[1,3,2,4,5,6],2], [[1,2,3,4,5,6],1] ] as [number[],number][]) {
    const state = nearFinish(order);
    play(state,order[4]);
    assert.deepEqual(state.finishOrder,order);
    assert.equal(state.settlement!.upgrade,upgrade);
    assert.equal(state.players[order[5] - 1].finishRank,6);
    assert.equal(state.players[order[5] - 1].hand.length,1);
    assert.equal(state.status,'settlement');
  }
});

test('levels cap at A and require winning an A round; fixed rooms end at the configured round', () => {
  const state = nearFinish([1,3,5,2,4,6],'K');
  play(state,4);
  assert.equal(state.teamLevels.A,'A');
  assert.equal(state.status,'settlement');
  const ace = nearFinish([1,2,3,4,5,6],'A');
  play(ace,5);
  assert.equal(ace.status,'finished');
  const reached = nearFinish([1,3,5,2,4,6],'K');
  reached.rules.mustBeatAce = false;
  play(reached,4);
  assert.equal(reached.status,'finished');
  const fixed = nearFinish([1,2,3,4,5,6]);
  fixed.rules.rounds = 2;
  fixed.round = 2;
  play(fixed,5);
  assert.equal(fixed.status,'finished');
  invalidWithoutMutation(fixed,'p1',{ type: 'next' });
});

test('next-round double tribute uses the lowest ranked opponents, never a winning teammate', () => {
  const state = nearFinish([1,3,2,4,5,6]);
  // Winner seats 1,3,5 occupy ranks 1,2,6: fixed rank 6 would incorrectly tribute to its teammate.
  state.finishOrder = [1,3,2,4];
  state.currentTurnSeat = 6;
  play(state,6);
  assert.deepEqual(state.settlement!.order,[1,3,2,4,6,5]);
  state.rules.resistance = false;
  applyAction(state,'p1',{ type: 'next' });
  assert.deepEqual(state.tribute.map(t => [t.from,t.to]),[[6,1],[4,3]]);
  assert.ok(state.tribute.every(t => state.players[t.from - 1].team !== state.players[t.to - 1].team));
  assert.ok(state.players.every(p => p.hand.length === 27));
});

function tributeFixture() {
  const state = handFixture([['3','8','K'],['4'],['5'],['6'],['7'],['9','BJ','A']]);
  state.status = 'tribute';
  state.tribute = [{ from: 6, to: 1, given: false, returned: false }];
  return state;
}

test('tribute confirms the highest non-wild card and return enforces low non-level cards without duplicating physical cards', () => {
  const state = tributeFixture();
  const allIds = state.players.flatMap(p => p.hand.map(c => c.id)).sort();
  invalidWithoutMutation(state,'p1',{ type: 'tribute', cardId: state.players[0].hand[0].id });
  invalidWithoutMutation(state,'p6',{ type: 'tribute', cardId: state.players[5].hand.find(c => c.rank === '9')!.id },/最大/);
  applyAction(state,'p6',{ type: 'tribute' });
  assert.equal(state.tribute[0].card!.rank,'BJ');
  invalidWithoutMutation(state,'p6',{ type: 'tribute' });
  invalidWithoutMutation(state,'p1',{ type: 'tribute', cardId: state.players[0].hand.find(c => c.rank === 'K')!.id },/10 以下/);
  const low = state.players[0].hand.find(c => c.rank === '3')!;
  applyAction(state,'p1',{ type: 'tribute', cardId: low.id });
  assert.equal(state.status,'playing');
  assert.equal(state.currentTurnSeat,6);
  assert.deepEqual(state.players.flatMap(p => p.hand.map(c => c.id)).sort(),allIds);
});

test('no low return card uses the smallest non-wild fallback and rejects a larger card', () => {
  const state = tributeFixture();
  state.players[0].hand = createDeck().filter(c => c.deckIndex === 2 && c.suit === 'spade' && ['10','J'].includes(c.rank));
  applyAction(state,'p6',{ type: 'tribute' });
  invalidWithoutMutation(state,'p1',{ type: 'tribute', cardId: state.players[0].hand.find(c => c.rank === 'J')!.id });
  applyAction(state,'p1',{ type: 'tribute', cardId: state.players[0].hand.find(c => c.rank === '10')!.id });
  assert.equal(state.tribute[0].returnCard!.rank,'10');
});

test('human timeout passes by default, safe free lead avoids wildcards, jokers and breaking bombs', () => {
  const state = handFixture([['3','4'],['5'],['6'],['7'],['8'],['9']]);
  play(state,1);
  state.deadline = 1000;
  assert.equal(tickGame(state,999),false);
  assert.equal(tickGame(state,1000),true);
  assert.equal(state.currentTurnSeat,3);
  assert.equal(state.players[1].autoPlay,true);
  assert.deepEqual(state.passSeats,[2]);
  const lead = handFixture([['3','3','3','3','4','BJ'],['5'],['6'],['7'],['8'],['9']]);
  lead.deadline = 1;
  tickGame(lead,1);
  assert.equal(lead.lastPlay!.cards[0].rank,'4');
  assert.equal(lead.lastPlay!.size,1);
});

test('unlimited turns have no automatic timeout; manual takeover is rejected if disabled', () => {
  const state = room({ turnSeconds: 0, allowAutoPlay: false });
  ready(state);
  applyAction(state,'p1',{ type: 'start' });
  assert.equal(state.deadline,null);
  assert.equal(tickGame(state,Number.MAX_SAFE_INTEGER),false);
  invalidWithoutMutation(state,'p1',{ type: 'auto', enabled: true },/未开启/);
});

test('connection recovery keeps the private hand and state; waiting host departure transfers ownership', () => {
  const state = handFixture([['3'],['4'],['5'],['6'],['7'],['8']]);
  const hand = structuredClone(state.players[0].hand);
  setConnected(state,'p1',false);
  assert.equal(state.players[0].connected,false);
  setConnected(state,'p1',true);
  assert.deepEqual(getRoomView(state,'p1').hand,hand);
  const waiting = room();
  applyAction(waiting,'p1',{ type: 'leave' });
  assert.equal(waiting.hostId,'p2');
  assert.equal(waiting.players.length,5);
  addPlayer(waiting,'replacement','新玩家');
  assert.equal(waiting.players.find(p => p.userId === 'replacement')!.seat,1);
});

test('bombs and played cards feed round and match statistics', () => {
  const state = handFixture([['5','5','5','5','3'],['4'],['6'],['7'],['8'],['9']]);
  applyAction(state,'p1',{ type: 'play', cardIds: state.players[0].hand.filter(c => c.rank === '5').map(c => c.id) });
  assert.equal(state.roundBomb,4);
  assert.equal(state.biggestBomb,4);
  assert.equal(state.matchStats.bombs[4],1);
  assert.equal(state.matchStats.biggestBomb,4);
  assert.equal(state.matchStats.totalPlays,state.totalPlays);
  assert.equal(state.playedCounts['5'],4);
});

test('match statistics accumulate rounds, sweeps and first places across rounds', () => {
  const state = nearFinish([1,3,5,2,4,6]);
  play(state,4);
  assert.equal(state.matchStats.rounds,1);
  assert.equal(state.matchStats.sweeps.A,1);
  assert.equal(state.matchStats.sweeps.B,0);
  assert.equal(state.matchStats.firsts.p1,1);
  assert.equal(state.settlement!.biggestBomb,0);
  assert.equal(state.playedCounts['6'],1);
  state.rules.resistance = false;
  applyAction(state,'p1',{ type: 'next' });
  assert.deepEqual(state.playedCounts,{});
  assert.equal(state.roundBomb,0);
  assert.equal(state.matchStats.rounds,1);
});

test('autoplay fully completes a dealt six-player round with valid unique finish ranks', () => {
  const state = room({ rounds: 1 });
  ready(state);
  applyAction(state,'p1',{ type: 'start' });
  for (const p of state.players) { p.bot = true; p.autoPlay = true; }
  state.deadline = 0;
  let turns = 0;
  while (state.status === 'playing' && turns < 1200) {
    assert.equal(tickGame(state,state.deadline!),true);
    assert.equal(new Set(state.players.flatMap(p => p.hand.map(c => c.id))).size,state.players.reduce((n,p) => n + p.hand.length,0));
    turns++;
  }
  assert.equal(state.status,'finished');
  assert.equal(state.finishOrder.length,6);
  assert.equal(new Set(state.finishOrder).size,6);
  assert.ok(state.totalPlays > 0);
  assert.ok(turns < 1200);
});
