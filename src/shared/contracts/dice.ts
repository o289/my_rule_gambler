import { BOARD_ROWS, GEM_ORDER } from '../../features/dice/model/geometry';
import type { GemId, Quaternion, Vec3 } from '../../features/dice/model/geometry';

export type RollKind = 'initial' | 'reroll';
export type DiceHz = 120 | 240;
export interface RollConfig { count: number; hz: DiceHz }
export const DEFAULT_CONFIG: Readonly<RollConfig> = { count: 5, hz: 120 };

export interface DiePose {
  id: string;
  p: Vec3;
  q: Quaternion;
  stopped: boolean;
}

export interface Impact { kind: 'floor' | 'wall' | 'dice'; strength: number }
export type RollPhase = 'collection' | 'cup' | 'rolling' | 'settled';

export interface Frame {
  rollId: string;
  seq: number;
  simMs: number;
  phase: RollPhase;
  dice: readonly DiePose[];
  hits: readonly Impact[];
}

export interface DiceResult {
  id: string;
  gem: GemId;
  approximate: boolean;
}

export interface RollView {
  id: string;
  kind: RollKind;
  config: RollConfig;
  previous: readonly DiePose[];
  latest: Frame;
  results: readonly DiceResult[];
  confirmed: boolean;
  nudges: number;
  deadline: boolean;
}

export interface Seat { id: string; name: string; online: boolean }
export interface Placement { row: number; column: number; gem: GemId; dieId?: string }
export interface GameState {
  seats: readonly Seat[];
  turnId: string | null;
  turnSequence: number;
  turnNotice: 'no-legal-placement' | null;
  phase: 'ready' | 'rolling' | 'confirm' | 'placement';
  revision: number;
  config: RollConfig;
  boardSeed?: number;
  placements: readonly Placement[];
  results: readonly DiceResult[];
  remaining: readonly string[];
  placedThisRoll: boolean;
  hasLegalPlacement: boolean;
}

export interface MatchWalletGroup {
  readonly denomination: 10 | 50 | 100;
  readonly count: number;
}

export interface MatchPlayerSetup {
  readonly id: string;
  readonly name: string;
  readonly slot: number;
  readonly score: number;
  readonly rank: number;
  readonly diceCount: number;
  readonly wallet: readonly MatchWalletGroup[];
}

export interface MatchResult {
  readonly status: 'continue' | 'won';
  readonly highestScore: number;
  readonly winners: readonly string[];
}

export interface SettlementRank {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
}

export interface MatchSettlementEvent {
  readonly boardSeed: number;
  readonly revision: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly rowId: string;
  readonly columnId: string;
  readonly rowPoints: number;
  readonly points: number;
  readonly gameEnded: boolean;
  readonly beforeRanks: readonly SettlementRank[];
  readonly afterRanks: readonly SettlementRank[];
}

export interface MatchSetup {
  readonly totalDice: 30;
  readonly unusedDiceCount: number;
  readonly placedDiceCount: number;
  readonly completedRows: readonly string[];
  readonly result: MatchResult | null;
  readonly players: readonly MatchPlayerSetup[];
}

export interface Metrics {
  hz: DiceHz;
  count: number;
  stepsPerSecond: number | null;
  sentPerSecond: number | null;
  meanStepMs: number | null;
  peakStepMs: number | null;
  cpuPercent: number | null;
  stoppedMs: number | null;
}

export type ClientMessage =
  | { type: 'join'; room: string; token?: string; dev?: boolean }
  | { type: 'roll' | 'reroll'; requestId: string; turnSequence?: number }
  | { type: 'confirm'; rollId: string }
  | { type: 'config'; config: RollConfig }
  | { type: 'place'; rollId: string; dieId: string; row: number; column?: number; revision?: number }
  | { type: 'end-turn'; revision: number; turnSequence?: number };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; token: string; dev: boolean; view: boolean; state: GameState; roll: RollView | null; match?: MatchSetup }
  | { type: 'state'; state: GameState; roll: RollView | null; match?: MatchSetup; settlement?: MatchSettlementEvent }
  | { type: 'frame'; frame: Frame }
  | { type: 'metrics'; metrics: Metrics }
  | { type: 'error'; code: string; message: string };

const roomPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const idPattern = /^[A-Za-z0-9-]{1,80}$/;
const tokenPattern = /^[A-Za-z0-9_-]{32}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is string { return typeof value === 'string' && idPattern.test(value); }
function int(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function config(value: unknown): value is RollConfig {
  return record(value) && int(value.count, 1, 5) && (value.hz === 120 || value.hz === 240);
}

export function roomName(input: string) {
  const value = input.trim().toLowerCase();
  return roomPattern.test(value) ? value : 'salon';
}

export function readClientMessage(value: unknown): ClientMessage | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'join': {
      const { room, token, dev } = value;
      if (typeof room !== 'string' || !roomPattern.test(room)
        || (token !== undefined && (typeof token !== 'string' || !tokenPattern.test(token)))
        || (dev !== undefined && typeof dev !== 'boolean')) return null;
      return { type: 'join', room, token, dev };
    }
    case 'roll':
    case 'reroll':
      return id(value.requestId) && (value.turnSequence === undefined || int(value.turnSequence))
        ? { type: value.type, requestId: value.requestId, turnSequence: value.turnSequence } : null;
    case 'confirm':
      return id(value.rollId) ? { type: 'confirm', rollId: value.rollId } : null;
    case 'config':
      return config(value.config) ? { type: 'config', config: value.config } : null;
    case 'place':
      return id(value.rollId) && id(value.dieId) && int(value.row, 0, BOARD_ROWS - 1)
        && (value.column === undefined || int(value.column, 0, GEM_ORDER.length - 1))
        && (value.revision === undefined || int(value.revision))
        ? { type: 'place', rollId: value.rollId, dieId: value.dieId, row: value.row, column: value.column, revision: value.revision } : null;
    case 'end-turn':
      return int(value.revision) && (value.turnSequence === undefined || int(value.turnSequence))
        ? { type: 'end-turn', revision: value.revision, turnSequence: value.turnSequence } : null;
    default:
      return null;
  }
}

function vector(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}
function quaternion(value: unknown): value is Quaternion {
  return Array.isArray(value) && value.length === 4 && value.every(finite);
}
function listOf<T>(value: unknown, item: (entry: unknown) => entry is T, limit: number): value is T[] {
  return Array.isArray(value) && value.length <= limit && value.every(item);
}
function gem(value: unknown): value is GemId {
  return GEM_ORDER.some(item => item === value);
}
function pose(value: unknown): value is DiePose {
  return record(value) && id(value.id) && vector(value.p) && quaternion(value.q) && typeof value.stopped === 'boolean';
}
function impact(value: unknown): value is Impact {
  return record(value) && (value.kind === 'floor' || value.kind === 'wall' || value.kind === 'dice')
    && finite(value.strength) && value.strength >= 0 && value.strength <= 1;
}
function frame(value: unknown): value is Frame {
  return record(value) && id(value.rollId) && int(value.seq) && finite(value.simMs)
    && ['collection', 'cup', 'rolling', 'settled'].some(phase => phase === value.phase)
    && listOf(value.dice, pose, 5) && listOf(value.hits, impact, 5);
}
function diceResult(value: unknown): value is DiceResult {
  return record(value) && id(value.id) && gem(value.gem) && typeof value.approximate === 'boolean';
}
function rollView(value: unknown): value is RollView {
  return record(value) && id(value.id) && (value.kind === 'initial' || value.kind === 'reroll')
    && config(value.config) && frame(value.latest) && listOf(value.previous, pose, 5)
    && listOf(value.results, diceResult, 5) && typeof value.confirmed === 'boolean'
    && int(value.nudges) && typeof value.deadline === 'boolean';
}
function seat(value: unknown): value is Seat {
  return record(value) && id(value.id) && typeof value.name === 'string' && typeof value.online === 'boolean';
}
function placement(value: unknown): value is Placement {
  return record(value) && int(value.row, 0, BOARD_ROWS - 1) && int(value.column, 0, GEM_ORDER.length - 1) && gem(value.gem)
    && (value.dieId === undefined || id(value.dieId));
}
function gameState(value: unknown): value is GameState {
  return record(value) && listOf(value.seats, seat, 6) && (value.turnId === null || id(value.turnId))
    && int(value.turnSequence) && (value.turnNotice === null || value.turnNotice === 'no-legal-placement')
    && ['ready', 'rolling', 'confirm', 'placement'].some(phase => phase === value.phase)
    && int(value.revision) && config(value.config)
    && (value.boardSeed === undefined || int(value.boardSeed, 0, 0xffff_ffff))
    && listOf(value.placements, placement, BOARD_ROWS * GEM_ORDER.length)
    && listOf(value.results, diceResult, 5) && listOf(value.remaining, id, 5)
    && typeof value.placedThisRoll === 'boolean' && typeof value.hasLegalPlacement === 'boolean';
}
function walletGroup(value: unknown): value is MatchWalletGroup {
  return record(value) && (value.denomination === 10 || value.denomination === 50 || value.denomination === 100)
    && int(value.count, 0, 30);
}
function matchPlayer(value: unknown): value is MatchPlayerSetup {
  return record(value) && id(value.id) && typeof value.name === 'string'
    && int(value.slot, 0, 5) && int(value.score) && int(value.rank, 1, 6) && int(value.diceCount, 0, 30)
    && listOf(value.wallet, walletGroup, 3)
    && value.wallet.reduce((total: number, group: MatchWalletGroup) => total + group.denomination * group.count, 0) === value.score;
}
function matchSetup(value: unknown): value is MatchSetup {
  if (!record(value) || value.totalDice !== 30 || !int(value.unusedDiceCount, 0, 30) || !int(value.placedDiceCount, 0, 30)
    || !listOf(value.completedRows, (item): item is string => typeof item === 'string' && item.length <= 80, 6)
    || !(value.result === null || matchResult(value.result))
    || !listOf(value.players, matchPlayer, 6) || value.players.length < 2) return false;
  const ids = new Set(value.players.map(player => player.id));
  const slots = new Set(value.players.map(player => player.slot));
  const result = value.result;
  const ranked = [...value.players].sort((left, right) => right.score - left.score);
  let expectedRank = 0;
  let priorScore: number | undefined;
  for (const [index, player] of ranked.entries()) {
    if (player.score !== priorScore) expectedRank = index + 1;
    if (player.rank !== expectedRank) return false;
    priorScore = player.score;
  }
  const highestScore = ranked[0]?.score ?? 0;
  const highestPlayers = ranked.filter(player => player.score === highestScore).map(player => player.id);
  return ids.size === value.players.length && slots.size === value.players.length
    && value.completedRows.length === new Set(value.completedRows).size
    && (result === null || result.winners.every(winner => ids.has(winner)))
    && (result === null || (result.highestScore === highestScore
      && (result.status === 'won' ? result.highestScore >= 500 && result.winners.length === highestPlayers.length
        && result.winners.every(winner => highestPlayers.includes(winner)) : result.highestScore < 500)))
    && value.players.reduce((total, player) => total + player.diceCount, value.unusedDiceCount + value.placedDiceCount) === value.totalDice;
}
function matchResult(value: unknown): value is MatchResult {
  return record(value) && (value.status === 'continue' || value.status === 'won') && int(value.highestScore, 0, Number.MAX_SAFE_INTEGER)
    && listOf(value.winners, id, 6) && ((value.status === 'won' && value.highestScore >= 500 && value.winners.length > 0)
      || (value.status === 'continue' && value.highestScore < 500 && value.winners.length === 0))
    && new Set(value.winners).size === value.winners.length;
}
function settlementRank(value: unknown): value is SettlementRank {
  return record(value) && id(value.id) && typeof value.name === 'string'
    && value.name.length > 0 && value.name.length <= 80 && int(value.rank, 1, 6);
}
function matchSettlementEvent(value: unknown): value is MatchSettlementEvent {
  if (!record(value)) return false;
  const beforeCandidate = value.beforeRanks;
  const afterCandidate = value.afterRanks;
  if (!int(value.boardSeed, 0, 0xffff_ffff) || !int(value.revision) || !id(value.playerId)
    || typeof value.playerName !== 'string' || !value.playerName.length || value.playerName.length > 80
    || !id(value.rowId) || !id(value.columnId)
    || typeof value.rowPoints !== 'number' || !Number.isSafeInteger(value.rowPoints) || value.rowPoints % 10 !== 0
    || typeof value.points !== 'number' || !Number.isSafeInteger(value.points) || value.points % 10 !== 0
    || typeof value.gameEnded !== 'boolean'
    || !listOf(beforeCandidate, settlementRank, 6) || !listOf(afterCandidate, settlementRank, 6)) return false;
  const beforeRanks = beforeCandidate;
  const afterRanks = afterCandidate;
  const uniqueRanks = (ranks: readonly SettlementRank[]) => {
    const ids = new Set(ranks.map(item => item.id));
    const playerId = value.playerId;
    return typeof playerId === 'string' && ids.size === ranks.length && ids.has(playerId)
      && ranks.every(item => item.rank <= ranks.length);
  };
  return beforeRanks.length >= 2 && beforeRanks.length === afterRanks.length
    && uniqueRanks(beforeRanks) && uniqueRanks(afterRanks)
    && beforeRanks.every(item => afterRanks.some(after => after.id === item.id));
}
function settlementMatchesMatch(event: MatchSettlementEvent, match: MatchSetup) {
  return event.gameEnded === (match.result?.status === 'won')
    && match.players.some(player => player.id === event.playerId && player.name === event.playerName)
    && event.afterRanks.length === match.players.length
    && event.afterRanks.every(rank => match.players.some(player => player.id === rank.id
      && player.name === rank.name && player.rank === rank.rank));
}
function metrics(value: unknown): value is Metrics {
  if (!record(value) || !config(value)) return false;
  return [value.stepsPerSecond, value.sentPerSecond, value.meanStepMs, value.peakStepMs, value.cpuPercent, value.stoppedMs]
    .every(item => item === null || finite(item));
}

export function readServerMessage(value: unknown): ServerMessage | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'frame': return frame(value.frame) ? { type: 'frame', frame: value.frame } : null;
    case 'state':
      return gameState(value.state) && (value.roll === null || rollView(value.roll))
        && (value.match === undefined || matchSetup(value.match))
        && (value.settlement === undefined || matchSettlementEvent(value.settlement))
        && (value.settlement === undefined || (value.match !== undefined
          && value.settlement.boardSeed === value.state.boardSeed
          && value.settlement.revision === value.state.revision
          && settlementMatchesMatch(value.settlement, value.match)))
        ? { type: 'state', state: value.state, roll: value.roll, ...(value.match === undefined ? {} : { match: value.match }),
          ...(value.settlement === undefined ? {} : { settlement: value.settlement }) } : null;
    case 'welcome':
      return id(value.playerId) && typeof value.token === 'string' && tokenPattern.test(value.token)
        && typeof value.dev === 'boolean' && typeof value.view === 'boolean'
        && gameState(value.state) && (value.roll === null || rollView(value.roll))
        && (value.match === undefined || matchSetup(value.match))
        ? { type: 'welcome', playerId: value.playerId, token: value.token, dev: value.dev, view: value.view, state: value.state, roll: value.roll, ...(value.match === undefined ? {} : { match: value.match }) }
        : null;
    case 'metrics': return metrics(value.metrics) ? { type: 'metrics', metrics: value.metrics } : null;
    case 'error':
      return typeof value.code === 'string' && typeof value.message === 'string'
        ? { type: 'error', code: value.code, message: value.message } : null;
    default: return null;
  }
}

export function parseJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch { return null; }
}
