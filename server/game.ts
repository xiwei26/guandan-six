import { randomInt } from 'node:crypto';
import { canBeat, cardStrength, createDeck, dealCards, findCombinations, findHints, isWildcard, shuffleDeck, sortCards } from '../shared/cards.ts';
import { DEFAULT_RULES, type Card, type GameAction, type GameState, type MatchStats, type Player, type Rank, type RoomView, type RuleConfig, type Team, type Tribute } from '../shared/types.ts';

const LEVELS: Rank[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const BOT_DELAY = 650;

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function note(state: GameState, message: string) {
  state.messages.push(message);
  state.messages = state.messages.slice(-12);
}

function playerAt(state: GameState, seat: number): Player {
  const player = state.players.find(p => p.seat === seat);
  requireThat(player, '座位不存在');
  return player;
}

function member(state: GameState, userId: string): Player {
  const player = state.players.find(p => p.userId === userId);
  requireThat(player, '你不在这个房间中');
  return player;
}

function teamFor(seat: number): Team { return seat % 2 === 1 ? 'A' : 'B'; }

function validatedRules(patch: Partial<RuleConfig>): RuleConfig {
  requireThat(patch && typeof patch === 'object' && !Array.isArray(patch), '房间规则格式错误');
  requireThat(Object.keys(patch).every(key => key in DEFAULT_RULES), '包含不支持的房间规则');
  const rules = { ...DEFAULT_RULES, ...patch };
  requireThat(rules.ruleVersion === '6P_V1' && rules.deckCount === 3 && rules.playerCount === 6 && rules.cardsPerPlayer === 27 && rules.teamSize === 3, '仅支持六人三副牌规则 6P_V1');
  requireThat([1,2,4,8,'A'].includes(rules.rounds), '不支持的局数');
  requireThat([0,15,30,60].includes(rules.turnSeconds), '不支持的出牌时限');
  requireThat(['showRemaining','allowAutoPlay','allowCounter','resistance','mustBeatAce'].every(key => typeof rules[key as keyof RuleConfig] === 'boolean'), '开关规则必须是布尔值');
  requireThat(Number.isInteger(rules.singleResistanceJokers) && rules.singleResistanceJokers >= 1 && rules.singleResistanceJokers <= 3, '单贡抗贡阈值必须为 1–3');
  requireThat(Number.isInteger(rules.teamResistanceJokers) && rules.teamResistanceJokers >= 1 && rules.teamResistanceJokers <= 3, '团队抗贡阈值必须为 1–3');
  requireThat(Number.isInteger(rules.straightFlushBeats) && rules.straightFlushBeats >= 4 && rules.straightFlushBeats <= 11, '同花顺等级必须位于 4–11 炸之间');
  return rules;
}

export function createMatchStats(): MatchStats { return { rounds: 0, firsts: {}, sweeps: { A: 0, B: 0 }, bombs: {}, biggestBomb: 0, totalPlays: 0 }; }

export function createRoom(roomId: string, hostId: string, nickname: string, rules: Partial<RuleConfig> = {}): GameState {
  requireThat(typeof roomId === 'string' && /^\d{6}$/.test(roomId), '房间号必须为六位数字');
  const state: GameState = {
    roomId, hostId, players: [], rules: validatedRules(rules), status: 'waiting', round: 0,
    currentLevel: '2', teamLevels: { A: '2', B: '2' }, currentTurnSeat: 1,
    lastPlay: null, lastPlaySeat: null, passSeats: [], finishOrder: [], tribute: [], tributeResisted: false,
    settlement: null, deadline: null, revision: 0, messages: [], totalPlays: 0, biggestBomb: 0, roundBomb: 0, playedCounts: {}, matchStats: createMatchStats(), createdAt: Date.now(),
  };
  addPlayer(state, hostId, nickname);
  return state;
}

export function addPlayer(state: GameState, userId: string, nickname: string, bot = false): void {
  requireThat(typeof userId === 'string' && userId.length > 0 && userId.length <= 100, '玩家身份无效');
  requireThat(typeof nickname === 'string' && nickname.trim().length > 0 && nickname.trim().length <= 20, '昵称需要 1–20 个字符');
  requireThat(!state.players.some(p => p.userId === userId), '你已经在房间中');
  requireThat(state.status === 'waiting', '牌局已经开始，无法加入');
  requireThat(state.players.length < 6, '房间已满');
  const seat = [1,2,3,4,5,6].find(s => !state.players.some(p => p.seat === s))!;
  state.players.push({ userId, nickname: nickname.trim(), seat, team: teamFor(seat), hand: [], ready: bot, autoPlay: bot, connected: true, bot });
  state.players.sort((a,b) => a.seat - b.seat);
  state.revision++;
  note(state, `${nickname.trim()} 加入了房间`);
}

function activeClockwise(state: GameState, after: number): Player[] {
  return state.players.filter(p => p.hand.length > 0 && p.finishRank === undefined)
    .sort((a,b) => ((a.seat - after + 5) % 6) - ((b.seat - after + 5) % 6));
}

function tributeActors(state: GameState): Player[] {
  return state.tribute.flatMap(t => !t.given ? [playerAt(state,t.from)] : !t.returned ? [playerAt(state,t.to)] : []);
}

function scheduleDeadline(state: GameState, now: number) {
  if (state.status !== 'playing' && state.status !== 'tribute') { state.deadline = null; return; }
  const actors = state.status === 'playing' ? [playerAt(state,state.currentTurnSeat)] : tributeActors(state);
  const automatic = actors.some(p => p.bot || p.autoPlay);
  state.deadline = automatic ? now + BOT_DELAY : state.rules.turnSeconds ? now + state.rules.turnSeconds * 1000 : null;
}

function makeTribute(state: GameState, order: number[], winner: Team, count: number) {
  // Choose opposing players by their actual finish order: fixed ranks 5/6 can contain a winner.
  const donors = order.filter(seat => playerAt(state,seat).team !== winner).reverse().slice(0,count);
  const recipients = order.filter(seat => playerAt(state,seat).team === winner).slice(0,count);
  state.tribute = donors.map((from,i) => ({ from, to: recipients[i], given: false, returned: false }));
  const opposing = state.players.filter(p => p.team !== winner);
  const kings = (p: Player) => p.hand.filter(c => c.rank === 'BJ').length;
  state.tributeResisted = state.rules.resistance && (count === 1
    ? kings(playerAt(state,donors[0])) >= state.rules.singleResistanceJokers
    : opposing.reduce((sum,p) => sum + kings(p),0) >= state.rules.teamResistanceJokers);
  if (state.tributeResisted) {
    state.tribute = [];
    state.currentTurnSeat = order[0];
    state.status = 'playing';
    note(state, '进贡方满足大王数量条件，本局抗贡，由上局头游首出');
  } else {
    state.currentTurnSeat = donors[0];
    state.status = 'tribute';
    note(state, `进入${count === 3 ? '三' : count === 2 ? '双' : '单'}贡阶段，请贡方确认最大非逢人配牌`);
  }
}

function startRound(state: GameState, now: number) {
  const previous = state.settlement;
  state.round++;
  state.currentLevel = previous ? state.teamLevels[previous.winner] : '2';
  const hands = dealCards(shuffleDeck(createDeck()));
  for (const player of state.players) {
    player.hand = sortCards(hands[player.seat - 1],state.currentLevel);
    delete player.finishRank;
    player.ready = false;
  }
  state.lastPlay = null;
  state.lastPlaySeat = null;
  state.passSeats = [];
  state.finishOrder = [];
  state.roundBomb = 0;
  state.playedCounts = {};
  state.tribute = [];
  state.tributeResisted = false;
  state.settlement = null;
  state.status = 'playing';
  state.currentTurnSeat = previous ? previous.order[0] : randomInt(1,7);
  note(state, `第 ${state.round} 局开始，本局打 ${state.currentLevel}`);
  if (previous) makeTribute(state,previous.order,previous.winner,previous.upgrade);
  scheduleDeadline(state,now);
}

function settleRound(state: GameState) {
  const last = state.players.find(p => p.finishRank === undefined);
  if (last) { last.finishRank = 6; state.finishOrder.push(last.seat); }
  const order = [...state.finishOrder];
  const winner = playerAt(state,order[0]).team;
  const sweep = order.slice(0,3).every(seat => playerAt(state,seat).team === winner);
  const upgrade = sweep ? 3 : playerAt(state,order[1]).team === winner ? 2 : 1;
  const fromLevel = state.teamLevels[winner];
  const toLevel = LEVELS[Math.min(LEVELS.indexOf(fromLevel) + upgrade,LEVELS.length - 1)];
  state.teamLevels[winner] = toLevel;
  const aceWon = state.rules.mustBeatAce ? fromLevel === 'A' && state.currentLevel === 'A' : toLevel === 'A';
  const matchOver = state.rules.rounds === 'A' ? aceWon : state.round >= state.rules.rounds;
  const reason = matchOver ? state.rules.rounds === 'A' ? state.rules.mustBeatAce ? '成功打过 A，整场结束' : '升级到 A，整场结束' : `已完成约定的 ${state.rules.rounds} 局` : `${winner === 'A' ? '蓝' : '橙'}队升级 ${upgrade} 级`;
  state.settlement = { order, winner, upgrade, fromLevel, toLevel, sweep, matchOver, reason, biggestBomb: state.roundBomb };
  const champion = playerAt(state,order[0]);
  state.matchStats.rounds = state.round;
  state.matchStats.firsts[champion.userId] = (state.matchStats.firsts[champion.userId] ?? 0) + 1;
  if (sweep) state.matchStats.sweeps[winner] = (state.matchStats.sweeps[winner] ?? 0) + 1;
  state.status = matchOver ? 'finished' : 'settlement';
  state.deadline = null;
  note(state, `${winner === 'A' ? '蓝' : '橙'}队获得头游，${fromLevel} → ${toLevel}。${reason}`);
}

function afterPlay(state: GameState, player: Player, now: number) {
  if (player.hand.length === 0) {
    state.finishOrder.push(player.seat);
    player.finishRank = state.finishOrder.length;
    note(state, `${player.nickname} 第 ${player.finishRank} 名出完`);
  }
  if (state.finishOrder.length === 5) { settleRound(state); return; }
  state.currentTurnSeat = activeClockwise(state,player.seat)[0].seat;
  scheduleDeadline(state,now);
}

function pass(state: GameState, player: Player, now: number) {
  requireThat(state.lastPlay !== null && state.lastPlaySeat !== null, '自由首出时不能不出');
  requireThat(!state.passSeats.includes(player.seat), '你本轮已经不出');
  state.passSeats.push(player.seat);
  const leader = playerAt(state,state.lastPlaySeat);
  const remaining = activeClockwise(state,leader.seat);
  const responders = remaining.filter(p => p.seat !== leader.seat);
  if (responders.every(p => state.passSeats.includes(p.seat))) {
    const next = leader.hand.length > 0 && leader.finishRank === undefined ? leader : remaining.find(p => p.team === leader.team) ?? remaining[0];
    requireThat(next, '当前没有有效出牌玩家');
    state.currentTurnSeat = next.seat;
    state.lastPlay = null;
    state.lastPlaySeat = null;
    state.passSeats = [];
    if (leader.finishRank !== undefined) note(state, `${next.nickname} ${next.team === leader.team ? '为队友接风' : '获得首出权'}`);
  } else {
    state.currentTurnSeat = activeClockwise(state,player.seat)[0].seat;
  }
  scheduleDeadline(state,now);
}

function ascending(hand: readonly Card[], level: Rank): Card[] {
  return [...hand].sort((a,b) => cardStrength(a,level) - cardStrength(b,level) || a.id.localeCompare(b.id));
}

function tributeCandidates(player: Player, level: Rank): Card[] {
  const eligible = player.hand.filter(c => !isWildcard(c,level));
  requireThat(eligible.length > 0, '没有可进贡的非逢人配牌');
  const strength = Math.max(...eligible.map(c => cardStrength(c,level)));
  return eligible.filter(c => cardStrength(c,level) === strength);
}

function returnCandidates(player: Player, level: Rank): Card[] {
  const eligible = player.hand.filter(c => c.rank !== level && c.suit !== 'joker' && Number(c.rank) >= 2 && Number(c.rank) < 10);
  if (eligible.length > 0) return ascending(eligible,level);
  // Three decks can rarely leave no small return card: fall back to the lowest non-wild card.
  const fallback = ascending(player.hand.filter(c => !isWildcard(c,level)),level);
  const cards = fallback.length ? fallback : ascending(player.hand,level);
  return cards.filter(c => cardStrength(c,level) === cardStrength(cards[0],level));
}

function exchange(state: GameState, player: Player, cardId: string | undefined, now: number) {
  requireThat(state.status === 'tribute', '当前不在进贡阶段');
  const donation = state.tribute.find(t => t.from === player.seat && !t.given);
  if (donation) {
    const eligible = tributeCandidates(player,state.currentLevel);
    const card = cardId === undefined ? eligible[0] : eligible.find(c => c.id === cardId);
    requireThat(card, '必须进贡最大的非逢人配牌');
    player.hand = player.hand.filter(c => c.id !== card.id);
    playerAt(state,donation.to).hand.push(card);
    donation.card = card;
    donation.given = true;
    note(state, `${player.nickname} 已确认进贡`);
  } else {
    const repayment = state.tribute.find(t => t.to === player.seat && t.given && !t.returned);
    requireThat(repayment, '请等待进贡，或你已完成本次贡还贡');
    requireThat(typeof cardId === 'string', '请选择一张还贡牌');
    const card = returnCandidates(player,state.currentLevel).find(c => c.id === cardId);
    requireThat(card, '还贡须为 10 以下非级牌；无此类牌时只能还最小非逢人配牌');
    player.hand = player.hand.filter(c => c.id !== card.id);
    playerAt(state,repayment.from).hand.push(card);
    repayment.returnCard = card;
    repayment.returned = true;
    note(state, `${player.nickname} 已还贡`);
  }
  for (const p of state.players) p.hand = sortCards(p.hand,state.currentLevel);
  if (state.tribute.every(t => t.given && t.returned)) {
    const first = [...state.tribute].sort((a,b) => cardStrength(b.card!,state.currentLevel) - cardStrength(a.card!,state.currentLevel))[0];
    state.currentTurnSeat = first.from;
    state.status = 'playing';
    note(state, '贡还贡完成，由贡牌最大的玩家首出');
  }
  scheduleDeadline(state,now);
}

function applyMutable(state: GameState, userId: string, action: GameAction, now: number) {
  requireThat(action && typeof action === 'object' && typeof action.type === 'string', '操作格式错误');
  const player = member(state,userId);
  switch (action.type) {
    case 'ready':
      requireThat(state.status === 'waiting', '牌局开始后不能修改准备状态');
      requireThat(typeof action.ready === 'boolean', '准备状态无效');
      player.ready = action.ready;
      break;
    case 'start':
      requireThat(userId === state.hostId, '只有房主可以开始');
      requireThat(state.status === 'waiting', '当前不能开始游戏');
      requireThat(state.players.length === 6 && state.players.every(p => p.ready), '需要六名玩家全部准备');
      startRound(state,now);
      break;
    case 'next':
      requireThat(userId === state.hostId, '只有房主可以开始下一局');
      requireThat(state.status === 'settlement', '当前不能开始下一局');
      startRound(state,now);
      break;
    case 'swap': {
      requireThat(userId === state.hostId, '只有房主可以换座');
      requireThat(state.status === 'waiting', '游戏开始后不能换座');
      requireThat(Number.isInteger(action.seat) && action.seat >= 1 && action.seat <= 6 && Number.isInteger(action.target) && action.target >= 1 && action.target <= 6, '座位必须为 1–6');
      requireThat(action.seat !== action.target, '请选择不同的座位');
      const source = playerAt(state,action.seat);
      const target = state.players.find(p => p.seat === action.target);
      requireThat(!source.ready && !target?.ready, '已准备玩家不能换座，请先取消准备');
      source.seat = action.target;
      source.team = teamFor(source.seat);
      if (target) { target.seat = action.seat; target.team = teamFor(target.seat); }
      state.players.sort((a,b) => a.seat - b.seat);
      note(state, '房主调整了座位，请确认队伍');
      break;
    }
    case 'shuffleTeams': {
      requireThat(userId === state.hostId && state.status === 'waiting', '只有房主可在准备阶段随机组队');
      requireThat(state.players.every(p => !p.ready), '请所有玩家先取消准备');
      const seats = [1,2,3,4,5,6];
      for (let i = seats.length - 1; i > 0; i--) { const j = randomInt(i + 1); [seats[i],seats[j]] = [seats[j],seats[i]]; }
      state.players.forEach((p,i) => { p.seat = seats[i]; p.team = teamFor(p.seat); });
      state.players.sort((a,b) => a.seat - b.seat);
      note(state, '已随机分配队伍，请确认座位后准备');
      break;
    }
    case 'play': {
      requireThat(state.status === 'playing' && player.seat === state.currentTurnSeat && player.finishRank === undefined, '还没有轮到你出牌');
      requireThat(Array.isArray(action.cardIds) && action.cardIds.length > 0 && action.cardIds.length <= 27 && action.cardIds.every(id => typeof id === 'string'), '请选择要出的牌');
      requireThat(new Set(action.cardIds).size === action.cardIds.length, '不能重复选择同一张牌');
      const cards = action.cardIds.map(id => player.hand.find(c => c.id === id));
      requireThat(cards.every((c): c is Card => c !== undefined), '出牌中包含不属于你的牌');
      const interpretations = findCombinations(cards,state.currentLevel,state.rules);
      requireThat(interpretations.length > 0, '所选牌不构成合法牌型');
      const combination = interpretations.find(c => canBeat(c,state.lastPlay,state.rules));
      requireThat(combination, '所选牌不能压过上一手牌');
      const ids = new Set(action.cardIds);
      player.hand = player.hand.filter(c => !ids.has(c.id));
      state.lastPlay = combination;
      state.lastPlaySeat = player.seat;
      state.passSeats = [];
      state.totalPlays++;
      state.matchStats.totalPlays = state.totalPlays;
      for (const card of combination.cards) state.playedCounts[card.rank] = (state.playedCounts[card.rank] ?? 0) + 1;
      if (combination.type === 'bomb') {
        state.biggestBomb = Math.max(state.biggestBomb,combination.size);
        state.roundBomb = Math.max(state.roundBomb,combination.size);
        state.matchStats.biggestBomb = state.biggestBomb;
        state.matchStats.bombs[combination.size] = (state.matchStats.bombs[combination.size] ?? 0) + 1;
      }
      afterPlay(state,player,now);
      break;
    }
    case 'pass':
      requireThat(state.status === 'playing' && player.seat === state.currentTurnSeat && player.finishRank === undefined, '还没有轮到你出牌');
      pass(state,player,now);
      break;
    case 'auto':
      requireThat(state.status === 'playing' || state.status === 'tribute', '游戏开始后才能使用托管');
      requireThat(typeof action.enabled === 'boolean', '托管状态无效');
      requireThat(!action.enabled || state.rules.allowAutoPlay, '此房间未开启主动托管');
      requireThat(!player.bot || action.enabled, '体验机器人不能取消托管');
      player.autoPlay = action.enabled;
      if (state.status === 'tribute' || player.seat === state.currentTurnSeat) scheduleDeadline(state,now);
      break;
    case 'tribute':
      requireThat(action.cardId === undefined || typeof action.cardId === 'string', '贡牌格式错误');
      exchange(state,player,action.cardId,now);
      break;
    case 'leave':
      if (state.status === 'waiting' || state.status === 'finished') {
        state.players = state.players.filter(p => p.userId !== userId);
        if (state.hostId === userId) state.hostId = state.players.find(p => !p.bot)?.userId ?? state.players[0]?.userId ?? '';
        note(state, `${player.nickname} 离开了房间`);
      } else {
        player.connected = false;
        if (state.rules.allowAutoPlay) player.autoPlay = true;
        if (player.userId === state.hostId) state.hostId = state.players.find(p => p.connected && !p.bot && p.userId !== userId)?.userId ?? state.hostId;
        if (state.status === 'tribute' || player.seat === state.currentTurnSeat) scheduleDeadline(state,now);
        note(state, `${player.nickname} 暂时离开，保留座位以便重连`);
      }
      break;
    default:
      throw new Error('不支持的操作');
  }
}

function applyAt(state: GameState, userId: string, action: GameAction, now: number) {
  // Transaction boundary: rejected actions cannot leave removed cards, changed turns, or ranks behind.
  const next = structuredClone(state);
  applyMutable(next,userId,action,now);
  next.revision++;
  Object.assign(state,next);
}

export function applyAction(state: GameState, userId: string, action: GameAction): void {
  applyAt(state,userId,action,Date.now());
}

export function getRoomView(state: GameState, userId: string): RoomView {
  const me = member(state,userId);
  const { players, ...publicState } = state;
  return structuredClone({
    ...publicState,
    players: players.map(({ hand, ...player }) => ({ ...player, remainingCards: state.rules.showRemaining || player.userId === userId ? hand.length : null })),
    mySeat: me.seat,
    hand: me.hand,
  });
}

function automaticLead(player: Player, state: GameState) {
  const hints = findHints(player.hand,null,state.currentLevel,state.rules);
  requireThat(hints.length > 0, '当前玩家没有合法首出牌');
  const counts = new Map<Rank,number>();
  for (const c of player.hand) if (!isWildcard(c,state.currentLevel)) counts.set(c.rank,(counts.get(c.rank) ?? 0) + 1);
  const safe = hints.filter(h => h.type !== 'bomb' && !h.cards.some(c => isWildcard(c,state.currentLevel) || c.suit === 'joker' || (counts.get(c.rank) ?? 0) >= 4));
  const candidates = safe.length ? safe : hints;
  if (!player.bot) return candidates[0];
  // Trial bots shed useful groups without claiming advanced AI or reading other hands.
  return [...candidates].sort((a,b) => b.size - a.size || a.rank - b.rank)[0];
}

export function tickGame(state: GameState, now = Date.now()): boolean {
  if ((state.status !== 'playing' && state.status !== 'tribute') || state.deadline === null || now < state.deadline) return false;
  const next = structuredClone(state);
  const actors = next.status === 'playing' ? [playerAt(next,next.currentTurnSeat)] : tributeActors(next);
  const player = actors.find(p => p.bot || p.autoPlay) ?? actors[0];
  if (!player) return false;
  if (!player.autoPlay && !player.bot && next.rules.allowAutoPlay) {
    player.autoPlay = true;
    note(next, `${player.nickname} 操作超时，已进入托管`);
  }
  let action: GameAction;
  if (next.status === 'tribute') {
    const donation = next.tribute.find(t => t.from === player.seat && !t.given);
    action = donation ? { type: 'tribute' } : { type: 'tribute', cardId: returnCandidates(player,next.currentLevel)[0].id };
  } else if (!next.lastPlay) {
    action = { type: 'play', cardIds: automaticLead(player,next).cards.map(c => c.id) };
  } else if (player.bot) {
    const leader = playerAt(next,next.lastPlaySeat!);
    const hints = leader.team === player.team ? [] : findHints(player.hand,next.lastPlay,next.currentLevel,next.rules);
    action = hints.length ? { type: 'play', cardIds: hints[0].cards.map(c => c.id) } : { type: 'pass' };
  } else {
    action = { type: 'pass' };
  }
  applyMutable(next,player.userId,action,now);
  next.revision++;
  Object.assign(state,next);
  return true;
}

export function setConnected(state: GameState, userId: string, connected: boolean): void {
  const player = member(state,userId);
  requireThat(typeof connected === 'boolean', '连接状态无效');
  if (player.connected === connected) return;
  player.connected = connected;
  state.revision++;
  note(state, `${player.nickname} ${connected ? '已重连' : '暂时断线'}`);
}
