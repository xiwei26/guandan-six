// 由 scripts/sync-shared.ts 从 shared/ 生成，请勿直接修改。
export type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A'|'SJ'|'BJ';
export type Suit = 'spade'|'heart'|'club'|'diamond'|'joker';
export type Team = 'A'|'B';
export interface Card { id: string; deckIndex: 0|1|2; suit: Suit; rank: Rank }
export type CombinationType = 'single'|'pair'|'triple'|'fullHouse'|'straight'|'threePairs'|'twoTriples'|'straightFlush'|'bomb';
export interface Combination { type: CombinationType; rank: number; size: number; cards: Card[]; label: string }
export interface RuleConfig {
 ruleVersion: '6P_V1'; deckCount: 3; playerCount: 6; cardsPerPlayer: 27; teamSize: 3;
 rounds: 1|2|4|8|'A'; turnSeconds: 0|15|30|60; showRemaining: boolean; allowAutoPlay: boolean; allowCounter: boolean;
 resistance: boolean; singleResistanceJokers: number; teamResistanceJokers: number;
 straightFlushBeats: number; mustBeatAce: boolean;
}
export const DEFAULT_RULES: RuleConfig = {ruleVersion:'6P_V1',deckCount:3,playerCount:6,cardsPerPlayer:27,teamSize:3,rounds:'A',turnSeconds:30,showRemaining:true,allowAutoPlay:true,allowCounter:true,resistance:true,singleResistanceJokers:2,teamResistanceJokers:3,straightFlushBeats:5,mustBeatAce:true};
export interface Player { userId: string; nickname: string; seat: number; team: Team; hand: Card[]; ready: boolean; autoPlay: boolean; connected: boolean; bot: boolean; finishRank?: number }
export interface PublicPlayer extends Omit<Player,'hand'> {remainingCards: number|null}
export interface Tribute { from: number; to: number; given: boolean; returned: boolean; card?: Card; returnCard?: Card }
export interface MatchStats { rounds: number; firsts: Record<string,number>; sweeps: Record<Team,number>; bombs: Record<number,number>; biggestBomb: number; totalPlays: number }
export interface Settlement { order: number[]; winner: Team; upgrade: number; fromLevel: Rank; toLevel: Rank; sweep: boolean; matchOver: boolean; reason: string; biggestBomb: number }
export interface GameState {
 roomId: string; hostId: string; players: Player[]; rules: RuleConfig; status: 'waiting'|'tribute'|'playing'|'settlement'|'finished';
 round: number; currentLevel: Rank; teamLevels: Record<Team,Rank>; currentTurnSeat: number;
 lastPlay: Combination|null; lastPlaySeat: number|null; passSeats: number[]; finishOrder: number[];
 tribute: Tribute[]; tributeResisted: boolean; settlement: Settlement|null; deadline: number|null;
 revision: number; messages: string[]; totalPlays: number; biggestBomb: number; roundBomb: number; playedCounts: Record<string,number>; matchStats: MatchStats; createdAt: number;
}
export interface RoomView extends Omit<GameState,'players'> {players: PublicPlayer[]; mySeat: number; hand: Card[]}
export type GameAction = {type:'ready';ready:boolean}|{type:'start'}|{type:'swap';seat:number;target:number}|{type:'shuffleTeams'}|{type:'play';cardIds:string[]}|{type:'pass'}|{type:'auto';enabled:boolean}|{type:'tribute';cardId?:string}|{type:'next'}|{type:'leave'};
export interface Session {token:string;userId:string;nickname:string;provider:'guest'|'wechat'}
export interface WechatLoginRequest {code:string;nickname?:string}
export interface HistoryEntry { roomId:string;round:number;at:number;winner:Team;upgrade:number;biggestBomb:number;order:{nickname:string;userId:string;seat:number;team:Team}[] }
export interface StatsSummary { rounds:number;wins:number;winRate:number;firsts:number;firstRate:number;sweeps:number;biggestBomb:number;rooms:number}
