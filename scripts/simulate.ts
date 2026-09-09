import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createDeck, dealCards, isWildcard, parseCombination, RANKS, shuffleDeck } from '../shared/cards';
import { addPlayer, applyAction, createRoom, getRoomView, tickGame } from '../server/game';
import type { GameState, Rank } from '../shared/types';

const option = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  assert.ok(Number.isSafeInteger(value) && value >= 0, `--${name} must be a nonnegative integer`);
  return value;
};
const dealCount = option('deals', 100_000);
const roundCount = option('games', 500);
const seed = option('seed', 20260907);
let randomState = seed >>> 0;
const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0x100000000; };
const deck = createDeck();
const allIds = new Set(deck.map(card => card.id));
const histogram: Record<number, number> = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 4, 0]));
let handsWithNaturalBomb = 0, handsWithSixPlusPotential = 0, handsWithThreeBigJokers = 0;
const started = performance.now();

for (let trial = 0; trial < dealCount; trial++) {
  const level = RANKS[trial % RANKS.length];
  const hands = dealCards(shuffleDeck(deck, random));
  const dealt = new Set(hands.flat().map(card => card.id));
  assert.equal(dealt.size, 162);
  assert.ok([...dealt].every(id => allIds.has(id)));
  for (const hand of hands) {
    assert.equal(hand.length, 27);
    const counts = new Map<Rank, number>();
    let wilds = 0;
    for (const card of hand) {
      assert.ok(parseCombination([card], level));
      if (isWildcard(card, level)) wilds++;
      else if (card.suit !== 'joker') counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    }
    let hasBomb = false;
    for (const [rank, count] of counts) if (count >= 4) {
      histogram[count]++;
      hasBomb = true;
      const cards = hand.filter(card => card.rank === rank && !isWildcard(card, level));
      assert.equal(parseCombination(cards, level)?.type, 'bomb');
    }
    if (hasBomb) handsWithNaturalBomb++;
    if ([...counts.values()].some(count => count + wilds >= 6)) handsWithSixPlusPotential++;
    if (hand.filter(card => card.rank === 'BJ').length === 3) handsWithThreeBigJokers++;
  }
  if ((trial + 1) % 25_000 === 0) process.stderr.write(`随机发牌验证 ${trial + 1}/${dealCount}\n`);
}
const dealingMs = Math.round(performance.now() - started);

let roundsCompleted = 0, matchesCompleted = 0, moves = 0, playedCombinations = 0;
let sweeps = 0, firstSeatTeamWins = 0, tributeRounds = 0, resistedRounds = 0, continuingWins = 0, roundsAfterTribute = 0;
let biggestBomb = 0, maximumRoundMoves = 0;
const playedBombs: Record<number, number> = {};
const observedTypes: Record<string, number> = {};
// Engine actions mutate state; accessor avoids TypeScript retaining stale loop narrowing.
const statusOf = (state: GameState): GameState['status'] => state.status;

function verify(state: GameState, discarded: Set<string>) {
  const remaining = state.players.flatMap(player => player.hand.map(card => card.id));
  assert.equal(new Set(remaining).size, remaining.length, 'A physical card appears in multiple hands');
  assert.equal(remaining.length + discarded.size, 162, 'Cards were lost or created');
  assert.ok(remaining.every(id => allIds.has(id) && !discarded.has(id)), 'Played card reappeared in a hand');
  assert.equal(new Set(state.finishOrder).size, state.finishOrder.length, 'Duplicate finish rank');
  for (const player of state.players) {
    if (player.finishRank && player.finishRank < 6) assert.equal(player.hand.length, 0);
    if (player.finishRank) assert.equal(state.finishOrder[player.finishRank - 1], player.seat);
  }
  if (state.status === 'playing') {
    const actor = state.players.find(player => player.seat === state.currentTurnSeat);
    assert.ok(actor && actor.hand.length > 0 && !actor.finishRank, 'Turn belongs to a finished or nonexistent player');
  }
}

while (roundsCompleted < roundCount) {
  const remainingRounds = roundCount - roundsCompleted;
  const rounds = remainingRounds >= 4 ? 4 : remainingRounds >= 2 ? 2 : 1;
  const state = createRoom('123456', 'p1', '模拟玩家 1', { rounds, turnSeconds: 0 });
  for (let seat = 2; seat <= 6; seat++) addPlayer(state, `p${seat}`, `模拟玩家 ${seat}`, true);
  state.players[0].bot = true;
  state.players[0].autoPlay = true;
  applyAction(state, 'p1', { type: 'ready', ready: true });
  applyAction(state, 'p1', { type: 'start' });
  let priorWinner: 'A' | 'B' | null = null;
  while (statusOf(state) !== 'finished') {
    const discarded = new Set<string>();
    let roundMoves = 0;
    const hasTribute = state.status === 'tribute';
    if (hasTribute) tributeRounds++;
    if (state.tributeResisted) resistedRounds++;
    if (state.round > 1) roundsAfterTribute++;
    const view = getRoomView(state, 'p1');
    assert.equal(view.hand.length, 27);
    assert.ok(view.players.every(player => !('hand' in player)), 'Another hand leaked to a client');
    verify(state, discarded);
    while (statusOf(state) === 'tribute') {
      assert.ok(tickGame(state, state.deadline ?? Date.now()));
      verify(state, discarded);
      assert.ok(++roundMoves < 10, 'Tribute phase did not complete');
    }
    assert.ok(state.players.every(player => player.hand.length === 27));
    const startingTeam = state.players.find(player => player.seat === state.currentTurnSeat)!.team;
    while (statusOf(state) === 'playing') {
      const playsBefore = state.totalPlays;
      assert.ok(tickGame(state, state.deadline ?? Date.now()), 'Simulation clock did not advance');
      if (state.totalPlays > playsBefore) {
        assert.ok(state.lastPlay);
        observedTypes[state.lastPlay.type] = (observedTypes[state.lastPlay.type] ?? 0) + 1;
        for (const card of state.lastPlay.cards) { assert.ok(!discarded.has(card.id), 'A card was played twice'); discarded.add(card.id); }
        if (state.lastPlay.type === 'bomb') playedBombs[state.lastPlay.size] = (playedBombs[state.lastPlay.size] ?? 0) + 1;
        playedCombinations++;
      }
      verify(state, discarded);
      assert.ok(++roundMoves < 3_000, 'Round failed to finish within 3,000 actions');
    }
    assert.ok(statusOf(state) === 'settlement' || statusOf(state) === 'finished');
    assert.ok(state.settlement);
    assert.equal(state.finishOrder.length, 6);
    assert.equal(new Set(state.finishOrder).size, 6);
    const winner = state.players.find(player => player.seat === state.finishOrder[0])!.team;
    const expectedUpgrade = state.finishOrder.slice(0, 3).every(seat => state.players.find(player => player.seat === seat)!.team === winner) ? 3
      : state.players.find(player => player.seat === state.finishOrder[1])!.team === winner ? 2 : 1;
    assert.equal(state.settlement.winner, winner);
    assert.equal(state.settlement.upgrade, expectedUpgrade);
    if (state.settlement.sweep) sweeps++;
    if (startingTeam === winner) firstSeatTeamWins++;
    if (priorWinner === winner) continuingWins++;
    priorWinner = winner;
    maximumRoundMoves = Math.max(maximumRoundMoves, roundMoves);
    biggestBomb = Math.max(biggestBomb, state.biggestBomb);
    moves += roundMoves;
    roundsCompleted++;
    if (roundsCompleted % 100 === 0) process.stderr.write(`完整对局验证 ${roundsCompleted}/${roundCount}\n`);
    if (statusOf(state) === 'finished') break;
    applyAction(state, 'p1', { type: 'next' });
  }
  matchesCompleted++;
}

const percentage = (numerator: number, denominator: number) => denominator ? Number((numerator / denominator * 100).toFixed(2)) : 0;
console.log(JSON.stringify({
  ruleVersion: '6P_V1',
  seed,
  note: '发牌分布使用固定种子；完整对局使用正式服务端加密洗牌。机器人数据仅用于技术验证，不代表真人平衡性或对局时长。天然炸弹按每种点数的完整张数组计数，不重复计入其子炸弹；六炸潜力包含可用逢人配，未计算重叠消耗。',
  randomDeals: {
    completed: dealCount, hands: dealCount * 6, physicalCardsValidated: dealCount * 162,
    naturalBombGroupsBySize: histogram,
    handsWithNaturalBombPercent: percentage(handsWithNaturalBomb, dealCount * 6),
    handsWithSixPlusPotentialPercent: percentage(handsWithSixPlusPotential, dealCount * 6),
    handsWithThreeBigJokersPercent: percentage(handsWithThreeBigJokers, dealCount * 6), elapsedMs: dealingMs,
  },
  games: {
    roundsCompleted, matchesCompleted, completionPercent: percentage(roundsCompleted, roundCount),
    actions: moves, playedCombinations, averageActionsPerRound: roundCount ? Number((moves / roundCount).toFixed(2)) : 0,
    maximumRoundMoves, observedTypes, playedBombs, biggestBomb, tributeRounds, resistedRounds,
    firstPlayerTeamWinPercent: percentage(firstSeatTeamWins, roundsCompleted), sweepPercent: percentage(sweeps, roundsCompleted),
    previousWinnerWinPercent: percentage(continuingWins, roundsAfterTribute),
    invariants: ['唯一实体牌', '162 张牌守恒', '不能重复出牌', '合法行动座位', '六人唯一排名', '头游队升级', '贡还贡后每人 27 张', '客户端仅下发自己的手牌'],
  },
  elapsedMs: Math.round(performance.now() - started),
}, null, 2));
