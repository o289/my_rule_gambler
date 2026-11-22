export interface CoinBundle {
  readonly denomination: number;
  readonly count: number;
}

export interface PlayerSeed {
  readonly id: string;
  readonly name: string;
  readonly turnOrder: number;
  readonly remainingDice: number;
  readonly coins: readonly CoinBundle[];
}

export interface Player extends PlayerSeed {
  readonly score: number;
}

export interface PlayerSnapshot {
  readonly players: readonly Player[];
  readonly currentTurnId: string;
  readonly youId: string;
  readonly turnVersion: number;
}

export interface ScoreChange {
  readonly id: number;
  readonly playerName: string;
  readonly amount: number;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_COUNT = 4;
export const SCORE_GAIN = 100;
export const SCORE_LOSS = -50;

function wallet(fifty: number, ten: number): readonly CoinBundle[] {
  return [{ denomination: 50, count: fifty }, { denomination: 10, count: ten }];
}

const DEMO_PLAYERS: readonly PlayerSeed[] = [
  { id: 'player-1', name: 'PLAYER 1', turnOrder: 1, remainingDice: 5, coins: wallet(6, 2) },
  { id: 'player-2', name: 'PLAYER 2', turnOrder: 2, remainingDice: 4, coins: wallet(5, 2) },
  { id: 'player-3', name: 'PLAYER 3', turnOrder: 3, remainingDice: 3, coins: wallet(6, 2) },
  { id: 'player-4', name: 'PLAYER 4', turnOrder: 4, remainingDice: 2, coins: wallet(3, 3) },
  { id: 'player-5', name: 'PLAYER 5', turnOrder: 5, remainingDice: 1, coins: wallet(2, 2) },
  { id: 'player-6', name: 'PLAYER 6', turnOrder: 6, remainingDice: 0, coins: wallet(1, 3) },
];

export function scoreCoins(coins: readonly CoinBundle[]) {
  return coins.reduce((total, coin) => total + coin.denomination * coin.count, 0);
}

function withScore(seed: PlayerSeed): Player {
  return { ...seed, score: scoreCoins(seed.coins) };
}

export function rankPlayers(players: readonly Player[]) {
  const sorted = [...players].sort((left, right) => right.score - left.score);
  const ranks = new Map<string, number>();
  let lastScore: number | undefined;
  let rank = 1;
  sorted.forEach((player, index) => {
    if (player.score !== lastScore) rank = index + 1;
    ranks.set(player.id, rank);
    lastScore = player.score;
  });
  return ranks;
}

type StoreListener = () => void;
type ScoreListener = (change: ScoreChange) => void;

export class PlayerInfoStore {
  private roster: readonly Player[] = [];
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<StoreListener>();
  private readonly scoreListeners = new Set<ScoreListener>();
  private changeId = 0;

  constructor(private readonly seed: readonly PlayerSeed[] = DEMO_PLAYERS) {
    if (seed.length < MIN_PLAYERS || seed.length > MAX_PLAYERS || new Set(seed.map(player => player.id)).size !== seed.length) {
      throw new RangeError('プレイヤーは異なる ID で2〜6人指定してください。');
    }
    this.roster = this.initialRoster();
    this.snapshot = this.initialSnapshot();
  }

  private initialRoster() {
    return [...this.seed].sort((left, right) => left.turnOrder - right.turnOrder).map(withScore);
  }

  private initialSnapshot(): PlayerSnapshot {
    const players = this.roster.slice(0, DEFAULT_COUNT);
    return {
      players,
      currentTurnId: players[1]?.id ?? '',
      youId: players[0]?.id ?? '',
      turnVersion: 0,
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: StoreListener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  subscribeScore = (listener: ScoreListener) => {
    this.scoreListeners.add(listener);
    return () => { this.scoreListeners.delete(listener); };
  };

  private publish(snapshot: PlayerSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private emitScore(player: Player, amount: number) {
    const event = { id: ++this.changeId, playerName: player.name, amount };
    for (const listener of this.scoreListeners) listener(event);
  }

  setCount(count: number) {
    if (!Number.isInteger(count) || count < MIN_PLAYERS || count > this.roster.length) return;
    const { currentTurnId, youId, turnVersion } = this.snapshot;
    const players = this.roster.slice(0, count);
    const first = players[0];
    if (!first || count === this.snapshot.players.length) return;
    const exists = (id: string) => players.some(player => player.id === id);
    const nextTurn = exists(currentTurnId) ? currentTurnId : first.id;
    this.publish({
      players, currentTurnId: nextTurn, youId: exists(youId) ? youId : first.id,
      turnVersion: turnVersion + (nextTurn === currentTurnId ? 0 : 1),
    });
  }

  setYou(id: string) {
    if (this.snapshot.youId === id || !this.snapshot.players.some(player => player.id === id)) return;
    this.publish({ ...this.snapshot, youId: id });
  }

  advanceTurn() {
    const { players, currentTurnId, turnVersion } = this.snapshot;
    const index = players.findIndex(player => player.id === currentTurnId);
    const next = players[(index + 1) % players.length];
    if (next) this.publish({ ...this.snapshot, currentTurnId: next.id, turnVersion: turnVersion + 1 });
  }

  adjustScore(id: string, requested: number) {
    const player = this.snapshot.players.find(item => item.id === id);
    if (!player || !Number.isSafeInteger(requested) || requested % 10 !== 0) return;
    const score = Math.max(0, player.score + requested);
    const amount = score - player.score;
    if (!Number.isSafeInteger(score) || !amount) return;
    const replacement = withScore({ ...player, coins: wallet(Math.floor(score / 50), (score % 50) / 10) });
    this.roster = this.roster.map(item => item.id === id ? replacement : item);
    this.publish({ ...this.snapshot, players: this.roster.slice(0, this.snapshot.players.length) });
    this.emitScore(replacement, amount);
  }

  previewScore(id: string, amount: number) {
    const player = this.snapshot.players.find(item => item.id === id);
    if (player && amount !== 0 && Number.isSafeInteger(amount)) this.emitScore(player, amount);
  }

  reset() {
    this.roster = this.initialRoster();
    const initial = this.initialSnapshot();
    this.publish({ ...initial, turnVersion: this.snapshot.turnVersion + 1 });
  }
}
