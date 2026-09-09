import test from 'node:test';
import assert from 'node:assert/strict';
import { canBeat, cardStrength, compareCombination, createDeck, dealCards, findCombinations, findHints, isWildcard, parseCombination, RANKS, shuffleDeck, sortCards } from '../shared/cards';
import { DEFAULT_RULES, type Card, type Combination, type Rank, type Suit } from '../shared/types';

const deck = createDeck();
function pick(rank: Rank, count = 1, suit?: Suit): Card[] {
  return deck.filter(card => card.rank === rank && (!suit || card.suit === suit)).slice(0, count);
}
function group(...groups: [Rank, number, Suit?][]): Card[] { return groups.flatMap(([rank, count, suit]) => pick(rank, count, suit)); }
function sequence(ranks: Rank[], copies = 1, suit?: Suit): Card[] { return ranks.flatMap(rank => pick(rank, copies, suit)); }
function play(cards: Card[], level: Rank = '8'): Combination {
  const parsed = parseCombination(cards, level);
  assert.ok(parsed, `Unrecognized ${cards.map(card => card.id).join(',')}`);
  return parsed;
}
function seeded(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}

test('three full decks have unique physical cards and deal 27 cards to six players', () => {
  assert.equal(deck.length, 162);
  assert.equal(new Set(deck.map(card => card.id)).size, 162);
  for (const rank of RANKS) assert.equal(deck.filter(card => card.rank === rank).length, 12);
  assert.equal(deck.filter(card => card.rank === 'SJ').length, 3);
  assert.equal(deck.filter(card => card.rank === 'BJ').length, 3);
  const before = deck.map(card => card.id);
  for (let seed = 0; seed < 100; seed++) {
    const shuffled = shuffleDeck(deck, seeded(seed));
    const hands = dealCards(shuffled);
    assert.deepEqual(hands.map(hand => hand.length), [27, 27, 27, 27, 27, 27]);
    assert.deepEqual(hands.flat().map(card => card.id).sort(), [...before].sort());
    assert.notDeepEqual(shuffled.map(card => card.id), before);
  }
  assert.deepEqual(deck.map(card => card.id), before);
  assert.throws(() => dealCards(deck.slice(1)));
  assert.throws(() => dealCards([...deck.slice(1), deck[1]]));
  assert.throws(() => shuffleDeck(deck, () => 1));
  assert.throws(() => shuffleDeck(deck, () => -0.01));
  assert.equal(shuffleDeck(deck).length, 162);
});

test('single strength and sorting promote level cards below the two jokers', () => {
  const cards = group(['A', 1], ['8', 1], ['2', 1], ['SJ', 1], ['BJ', 1]);
  assert.deepEqual(sortCards(cards, '8').map(card => card.rank), ['BJ', 'SJ', '8', 'A', '2']);
  assert.equal(cardStrength(pick('8')[0], '8'), 15);
  assert.equal(play(pick('8', 1, 'heart')).rank, 15);
  assert.equal(isWildcard(pick('8', 1, 'heart')[0], '8'), true);
  assert.equal(isWildcard(pick('8', 1, 'spade')[0], '8'), false);
  const original = cards.map(card => card.id);
  sortCards(cards, '8', 'suit');
  assert.deepEqual(cards.map(card => card.id), original);
});

test('recognizes all basic groups and compares full houses by triple only', () => {
  assert.equal(play(pick('4')).type, 'single');
  assert.equal(play(pick('4', 2)).type, 'pair');
  assert.equal(play(pick('4', 3)).type, 'triple');
  assert.equal(play(group(['4', 3], ['A', 2])).type, 'fullHouse');
  assert.ok(canBeat(play(group(['5', 3], ['2', 2])), play(group(['4', 3], ['A', 2]))));
  assert.equal(compareCombination(play(group(['4', 3], ['A', 2])), play(group(['4', 3], ['2', 2]))), 0);
  assert.equal(parseCombination(group(['4', 2], ['5', 2]), '8'), null);
  assert.equal(parseCombination(group(['4', 3], ['5', 1]), '8'), null);
  assert.equal(parseCombination([deck[0], deck[0]], '8'), null);
  assert.equal(parseCombination([], '8'), null);
});

test('ace can be low or high in sequences but cannot wrap through the middle', () => {
  const low = play(sequence(['A', '2', '3', '4', '5']));
  const high = play(sequence(['10', 'J', 'Q', 'K', 'A']));
  assert.equal(low.rank, 5);
  assert.equal(high.rank, 14);
  assert.ok(canBeat(high, low));
  assert.equal(play(sequence(['A', '2', '3'], 2)).type, 'threePairs');
  assert.equal(play(sequence(['A', '2'], 3)).type, 'twoTriples');
  assert.equal(play(sequence(['K', 'A'], 3)).rank, 14);
  assert.equal(parseCombination(sequence(['Q', 'K', 'A', '2', '3']), '8'), null);
  assert.equal(parseCombination(sequence(['K', 'A', '2'], 2), '8'), null);
  assert.equal(parseCombination(sequence(['2', '3', '4', '5', '6', '7']), '8'), null);
  // The level does not move within a sequence.
  assert.equal(play(sequence(['6', '7', '8', '9', '10']), '8').rank, 10);
});

test('bomb length outranks rank and straight flush position follows configuration', () => {
  const flush = play(sequence(['3', '4', '5', '6', '7'], 1, 'club'));
  assert.equal(flush.type, 'straightFlush');
  for (let size = 4; size <= 12; size++) {
    const bomb = play(pick('4', size));
    assert.equal(bomb.type, 'bomb');
    assert.equal(bomb.size, size);
    assert.equal(canBeat(bomb, flush), size >= 6);
    assert.equal(canBeat(flush, bomb), size <= 5);
  }
  assert.ok(canBeat(play(pick('2', 5)), play(pick('A', 4))));
  assert.ok(canBeat(play(pick('8', 4)), play(pick('A', 4))));
  assert.ok(canBeat(flush, play(pick('2', 6)), { ...DEFAULT_RULES, straightFlushBeats: 6 }));
  assert.equal(canBeat(play(pick('4', 2)), play(pick('3', 3))), false);
  assert.equal(canBeat(play(pick('4', 2)), play(pick('4', 2))), false);
  assert.ok(canBeat(play(pick('2', 4)), play(pick('BJ', 3))));
  const thirteen = [...pick('4', 12), ...pick('8', 1, 'heart')];
  assert.equal(parseCombination(thirteen, '8'), null);
});

test('three heart level wildcards fill groups, sequences, flushes and bombs', () => {
  const wild = pick('8', 3, 'heart');
  assert.equal(play([...pick('5'), wild[0]]).type, 'pair');
  assert.equal(play([...pick('5'), ...wild.slice(0, 2)]).type, 'triple');
  assert.equal(play([...pick('5'), ...wild]).type, 'bomb');
  assert.equal(play([...pick('5', 9), ...wild]).size, 12);
  assert.equal(play([...pick('A', 2), ...pick('4', 2), wild[0]]).type, 'fullHouse');
  assert.equal(play([...sequence(['3', '4', '5', '7'], 1, 'club'), wild[0]]).type, 'straightFlush');
  assert.ok(findCombinations([...pick('3', 2), ...pick('4'), ...wild], '8').some(value => value.type === 'threePairs'));
  assert.equal(play([...pick('3', 3), ...pick('4'), ...wild.slice(0, 2)]).type, 'twoTriples');
  assert.equal(play(wild).rank, 15);
  assert.equal(play(wild.slice(0, 2)).rank, 15);
});

test('jokers form natural pairs and triples but never accept wildcards or mixed-joker bombs', () => {
  for (const rank of ['SJ', 'BJ'] as const) {
    assert.equal(play(pick(rank, 2)).type, 'pair');
    assert.equal(play(pick(rank, 3)).type, 'triple');
    assert.equal(parseCombination([...pick(rank), ...pick('8', 1, 'heart')], '8'), null);
    assert.equal(parseCombination([...pick(rank, 3), ...pick('8', 1, 'heart')], '8'), null);
  }
  assert.equal(parseCombination(group(['SJ', 2], ['BJ', 2]), '8'), null);
  assert.equal(parseCombination(group(['SJ', 3], ['BJ', 3]), '8'), null);
  assert.equal(play(group(['BJ', 3], ['SJ', 2])).type, 'fullHouse');
  assert.equal(play([...pick('BJ', 3), ...pick('8', 2, 'heart')]).rank, 17);
});

test('wildcard ambiguity preserves every legal response interpretation', () => {
  const cards = [...pick('3', 1, 'club'), ...pick('4', 1, 'diamond'), ...pick('8', 3, 'heart')];
  const all = findCombinations(cards, '8');
  assert.ok(all.some(value => value.type === 'straight'));
  assert.ok(all.some(value => value.type === 'fullHouse' && value.rank === 4));
  const previous = play(group(['2', 3], ['A', 2]));
  assert.ok(all.some(value => canBeat(value, previous)));
  assert.ok(findHints(cards, previous, '8').some(value => value.type === 'fullHouse'));
});

test('hints provide the cheapest intact group first, hold wildcards, and include bombs last', () => {
  const hand = group(['3', 4], ['4', 1], ['5', 2], ['8', 1, 'heart'], ['BJ', 1]);
  assert.equal(findHints(hand, play(pick('2')), '8')[0].cards[0].rank, '4');
  const replies = findHints(hand, play(pick('4', 2)), '8');
  assert.equal(replies[0].type, 'pair');
  assert.ok(replies[0].cards.every(card => card.rank === '5'));
  assert.ok(replies.some(value => value.type === 'bomb'));
  const firstBomb = replies.findIndex(value => value.type === 'bomb' || value.type === 'straightFlush');
  assert.ok(replies.slice(firstBomb).every(value => value.type === 'bomb' || value.type === 'straightFlush'));
  const full = findHints(group(['3', 2], ['4', 3], ['8', 2, 'heart']), play(group(['2', 3], ['A', 2])), '8');
  assert.ok(full.some(value => value.type === 'fullHouse'));
});

test('constructive hints cover brute-force legal shapes on small wildcard-rich hands', () => {
  const rng = seeded(3921);
  const pool = deck.filter(card => ['2', '3', '4', '5', '6', 'SJ', 'BJ'].includes(card.rank));
  for (let trial = 0; trial < 12; trial++) {
    const hand = [...shuffleDeck(pool, rng).slice(0, 5), ...pick('8', 2, 'heart')];
    const hintKeys = new Set(findHints(hand, null, '8').map(value => `${value.type}:${value.rank}:${value.size}`));
    for (let mask = 1; mask < 1 << hand.length; mask++) {
      const selection = hand.filter((_, i) => mask & (1 << i));
      for (const value of findCombinations(selection, '8')) assert.ok(hintKeys.has(`${value.type}:${value.rank}:${value.size}`), `Missing ${value.type}:${value.rank}:${value.size}`);
    }
    for (const hint of findHints(hand, null, '8')) {
      assert.equal(new Set(hint.cards.map(card => card.id)).size, hint.cards.length);
      assert.ok(hint.cards.every(card => hand.some(own => own.id === card.id)));
      assert.ok(findCombinations(hint.cards, '8').some(value => value.type === hint.type && value.rank === hint.rank));
    }
  }
});
