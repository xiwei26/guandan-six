import { DEFAULT_RULES, type Card, type Combination, type CombinationType, type Rank, type RuleConfig, type Suit } from './types';

export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const ALL_RANKS: Rank[] = [...RANKS, 'SJ', 'BJ'];
const SUITS: Suit[] = ['spade', 'heart', 'club', 'diamond'];
const NAMES: Record<CombinationType, string> = { single: '单张', pair: '对子', triple: '三张', fullHouse: '三带二', straight: '顺子', threePairs: '三连对', twoTriples: '钢板', straightFlush: '同花顺', bomb: '炸弹', jokerBomb:'三王炸', kingBomb:'天王炸' };
const NATURAL: Record<string, number> = Object.fromEntries(ALL_RANKS.map((rank, i) => [rank, i + 2]));

export function isWildcard(card: Card, level: Rank): boolean { return card.suit === 'heart' && card.rank === level; }
export function cardStrength(card: Card, level: Rank): number {
  return card.rank === 'BJ' ? 17 : card.rank === 'SJ' ? 16 : card.rank === level ? 15 : NATURAL[card.rank];
}
function rankStrength(rank: Rank, level: Rank): number {
  return cardStrength({ id: '', deckIndex: 0, rank, suit: rank.endsWith('J') && rank !== 'J' ? 'joker' : 'spade' }, level);
}
function validCard(card: Card): boolean {
  return !!card && typeof card.id === 'string' && [0, 1, 2].includes(card.deckIndex) && ALL_RANKS.includes(card.rank)
    && (card.rank === 'SJ' || card.rank === 'BJ' ? card.suit === 'joker' : SUITS.includes(card.suit));
}

export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const deckIndex of [0, 1, 2] as const) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ id: `${deckIndex}-${suit}-${rank}`, deckIndex, suit, rank });
    for (const rank of ['SJ', 'BJ'] as const) cards.push({ id: `${deckIndex}-joker-${rank}`, deckIndex, suit: 'joker', rank });
  }
  return cards;
}

/** Fisher–Yates. Production uses rejection sampling over cryptographic random bytes. */
export function shuffleDeck(cards: readonly Card[], rng?: () => number): Card[] {
  const result = [...cards];
  const random = new Uint32Array(1);
  for (let i = result.length - 1; i > 0; i--) {
    let j: number;
    if (rng) {
      const value = rng();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机数必须处于 [0, 1)');
      j = Math.floor(value * (i + 1));
    } else {
      const limit = Math.floor(0x100000000 / (i + 1)) * (i + 1);
      do { globalThis.crypto.getRandomValues(random); } while (random[0] >= limit);
      j = random[0] % (i + 1);
    }
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function dealCards(deck: readonly Card[]): Card[][] {
  if (deck.length !== 162 || new Set(deck.map(card => card.id)).size !== 162 || !deck.every(validCard)) throw new Error('发牌必须使用 162 张唯一的有效牌');
  const hands: Card[][] = Array.from({ length: 6 }, () => []);
  deck.forEach((card, i) => hands[i % 6].push(card));
  return hands;
}

export function sortCards(hand: readonly Card[], level: Rank, mode: 'rank' | 'suit' = 'rank'): Card[] {
  const suitIndex = (card: Card) => card.suit === 'joker' ? -1 : SUITS.indexOf(card.suit);
  return [...hand].sort((a, b) => (mode === 'suit' ? suitIndex(a) - suitIndex(b) : 0)
    || cardStrength(b, level) - cardStrength(a, level) || suitIndex(a) - suitIndex(b) || a.deckIndex - b.deckIndex || a.id.localeCompare(b.id));
}

interface Target { rank: Rank; count: number }
interface Pattern { type: CombinationType; strength: number; targets: Target[]; suit?: Suit }
function sequences(length: number): Rank[][] {
  const values: Rank[] = ['A', ...RANKS];
  return Array.from({ length: values.length - length + 1 }, (_, start) => values.slice(start, start + length));
}
const SEQUENCES = { 2: sequences(2), 3: sequences(3), 5: sequences(5) };

function* patterns(size: number | null, level: Rank, requested?: CombinationType, rules: RuleConfig = DEFAULT_RULES): Generator<Pattern> {
  const wants = (type: CombinationType, count: number) => (size === null || size === count) && (!requested || requested === type);
  for (const [type, count] of [['single', 1], ['pair', 2], ['triple', 3], ['bomb', 4]] as const) {
    const counts = type === 'bomb' ? Array.from({ length: 9 }, (_, i) => i + 4) : [count];
    for (const n of counts) if (wants(type, n)) {
      for (const rank of type === 'bomb' || (type === 'triple' && rules.ruleVersion === '6P_V2') ? RANKS : ALL_RANKS) yield { type, strength: rankStrength(rank, level), targets: [{ rank, count: n }] };
    }
  }
  if (rules.ruleVersion === '6P_V2') {
    if (wants('jokerBomb',3)) for (const rank of ['SJ','BJ'] as const) yield {type:'jokerBomb',strength:rankStrength(rank,level),targets:[{rank,count:3}]};
    if (wants('kingBomb',6)) yield {type:'kingBomb',strength:100,targets:[{rank:'BJ',count:3},{rank:'SJ',count:3}]};
  }
  if (wants('fullHouse', 5)) for (const triple of ALL_RANKS) for (const pair of ALL_RANKS) {
    if (triple !== pair) yield { type: 'fullHouse', strength: rankStrength(triple, level), targets: [{ rank: triple, count: 3 }, { rank: pair, count: 2 }] };
  }
  for (const [type, length, repeats] of [['straight', 5, 1], ['straightFlush', 5, 1], ['threePairs', 3, 2], ['twoTriples', 2, 3]] as const) {
    if (!wants(type, length * repeats)) continue;
    for (const sequence of SEQUENCES[length]) {
      const base = { type, strength: NATURAL[sequence[sequence.length - 1]], targets: sequence.map(rank => ({ rank, count: repeats })) };
      if (type === 'straightFlush') for (const suit of SUITS) yield { ...base, suit };
      else yield base;
    }
  }
}

function combination(pattern: Pattern, cards: readonly Card[]): Combination {
  return { type: pattern.type, rank: pattern.strength, size: cards.length, cards: [...cards], label: pattern.type === 'bomb' ? `${cards.length} 炸` : pattern.type === 'jokerBomb' ? pattern.strength === 17 ? '三大王炸' : '三小王炸' : NAMES[pattern.type] };
}
function power(play: Combination, rules: RuleConfig): number {
  if (play.type === 'kingBomb') return 100;
  if (play.type === 'jokerBomb') return 13;
  return play.type === 'bomb' ? play.size * 2 : play.type === 'straightFlush' ? rules.straightFlushBeats * 2 + 1 : 0;
}
/** A positive result means a beats b; incomparable ordinary shapes return zero. */
export function compareCombination(a: Combination, b: Combination, rules: RuleConfig = DEFAULT_RULES): number {
  const first = power(a, rules), second = power(b, rules);
  if (first || second) return first - second || a.rank - b.rank;
  return a.type === b.type && a.size === b.size ? a.rank - b.rank : 0;
}
export function canBeat(a: Combination, b: Combination | null, rules: RuleConfig = DEFAULT_RULES): boolean {
  return b === null || compareCombination(a, b, rules) > 0;
}

/** All interpretations of selected physical cards; wildcards never stand for jokers. */
export function findCombinations(cards: readonly Card[], level: Rank, rules: RuleConfig = DEFAULT_RULES): Combination[] {
  if (!cards.length || cards.length > 12 || !RANKS.includes(level) || !cards.every(validCard) || new Set(cards.map(card => card.id)).size !== cards.length) return [];
  const wilds = cards.filter(card => isWildcard(card, level));
  if (wilds.length > 3) return [];
  // A lone heart level card is a level card, never an arbitrarily chosen single.
  if (cards.length === 1) return [{ type: 'single', rank: cardStrength(cards[0], level), size: 1, cards: [...cards], label: NAMES.single }];
  const naturals = cards.filter(card => !isWildcard(card, level));
  const result: Combination[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns(cards.length, level, undefined, rules)) {
    if (pattern.suit && naturals.some(card => card.suit !== pattern.suit)) continue;
    const remaining = new Map(pattern.targets.map(target => [target.rank, target.count]));
    let fits = true;
    for (const card of naturals) {
      const count = remaining.get(card.rank) ?? 0;
      if (count < 1) { fits = false; break; }
      remaining.set(card.rank, count - 1);
    }
    if (!fits || (remaining.get('SJ') ?? 0) > 0 || (remaining.get('BJ') ?? 0) > 0) continue;
    const key = `${pattern.type}:${pattern.strength}`;
    if (!seen.has(key)) { seen.add(key); result.push(combination(pattern, cards)); }
  }
  const order: CombinationType[] = ['single', 'pair', 'triple', 'fullHouse', 'threePairs', 'twoTriples', 'straight', 'straightFlush', 'bomb'];
  return result.sort((a, b) => power(b, rules) - power(a, rules) || order.indexOf(b.type) - order.indexOf(a.type) || b.rank - a.rank);
}
export function parseCombination(cards: readonly Card[], level: Rank, rules: RuleConfig = DEFAULT_RULES): Combination | null {
  return findCombinations(cards, level, rules)[0] ?? null;
}

/** Construct rank templates, not n-choose-k subsets. Equivalent physical copies are collapsed. */
export function findHints(hand: readonly Card[], lastPlay: Combination | null, level: Rank, rules: RuleConfig = DEFAULT_RULES): Combination[] {
  if (!hand.length || !RANKS.includes(level)) return [];
  const wilds = hand.filter(card => isWildcard(card, level));
  const naturalHand = hand.filter(card => !isWildcard(card, level));
  const buckets = new Map<Rank, Card[]>();
  for (const card of naturalHand) {
    const bucket = buckets.get(card.rank) ?? [];
    bucket.push(card); buckets.set(card.rank, bucket);
  }
  const result: Combination[] = [];
  const seen = new Set<string>();
  const add = (pattern: Pattern, cards: Card[]) => {
    const value = combination(pattern, cards);
    if (!canBeat(value, lastPlay, rules)) return;
    const key = `${value.type}:${value.rank}:${cards.map(card => card.id).sort().join(',')}`;
    if (!seen.has(key)) { seen.add(key); result.push(value); }
  };
  const bombs: CombinationType[] = ['bomb','straightFlush','jokerBomb','kingBomb'];
  const types: CombinationType[] = lastPlay ? (power(lastPlay, rules) ? bombs : [lastPlay.type, ...bombs])
    : ['single', 'pair', 'triple', 'fullHouse', 'straight', 'threePairs', 'twoTriples', ...bombs];
  for (const type of types) {
    if (type === 'single') {
      const representatives = new Map<Rank, Card>();
      // Prefer the non-wild level card when either physical card has the same single value.
      for (const card of [...naturalHand, ...wilds]) if (!representatives.has(card.rank)) representatives.set(card.rank, card);
      for (const card of representatives.values()) add({ type: 'single', strength: cardStrength(card, level), targets: [] }, [card]);
      continue;
    }
    for (const pattern of patterns(null, level, type, rules)) {
      const count = pattern.targets.reduce((sum, target) => sum + target.count, 0);
      if (count > hand.length || !canBeat(combination(pattern, Array(count).fill(null)), lastPlay, rules)) continue;
      const sources = pattern.targets.map(target => (buckets.get(target.rank) ?? []).filter(card => !pattern.suit || card.suit === pattern.suit));
      const minimumWilds = pattern.targets.reduce((sum, target, i) => sum + Math.max(0, target.count - sources[i].length), 0);
      if (minimumWilds > wilds.length || pattern.targets.some((target, i) => (target.rank === 'SJ' || target.rank === 'BJ') && sources[i].length < target.count)) continue;
      const collect = (index: number, usedWilds: number, selected: Card[]) => {
        if (index === pattern.targets.length) { add(pattern, [...selected, ...wilds.slice(0, usedWilds)]); return; }
        const target = pattern.targets[index];
        const source = sources[index];
        const maximumTake = Math.min(target.count, source.length);
        const minimumTake = target.rank === 'SJ' || target.rank === 'BJ' ? target.count : Math.max(0, target.count - (wilds.length - usedWilds));
        for (let take = maximumTake; take >= minimumTake; take--) collect(index + 1, usedWilds + target.count - take, [...selected, ...source.slice(0, take)]);
      };
      collect(0, 0, []);
    }
  }
  const score = (play: Combination): number[] => {
    const used = new Map<Rank, number>();
    let wildcardCount = 0, jokerCount = 0;
    for (const card of play.cards) {
      if (isWildcard(card, level)) wildcardCount++;
      else used.set(card.rank, (used.get(card.rank) ?? 0) + 1);
      if (card.suit === 'joker') jokerCount++;
    }
    let brokenBombs = 0;
    for (const [rank, count] of used) if ((buckets.get(rank)?.length ?? 0) >= 4 && count < (buckets.get(rank)?.length ?? 0)) brokenBombs++;
    return [power(play, rules) ? 1 : 0, brokenBombs, wildcardCount, jokerCount, power(play, rules), play.rank, -play.size];
  };
  const scored = result.map(play => ({ play, score: score(play) }));
  scored.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    return a.play.type.localeCompare(b.play.type);
  });
  return scored.map(item => item.play);
}
