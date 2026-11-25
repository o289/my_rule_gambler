import type { CasinoRoomInfo, Seat } from '../../../shared/contracts/casino-entry';
import { GEM_ORDER } from '../../../features/dice/model/geometry';
import type { DiceResult, DiePose, Frame, MatchPlayerSetup, MatchResult, Placement, RollConfig, RollView } from '../../../shared/contracts/dice';
import type { DiceGameState } from './dice-game';
import type { LobbyCountdownState } from './lobby';

export interface SavedParticipant {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  token: string;
  online: boolean;
  leftAt: number | null;
  exited: boolean;
  viewedRoll: string | null;
  dev: boolean;
  seenRequests: string[];
}

export interface SavedMatchPlayer {
  id: string;
  score: number;
  wallet: MatchPlayerSetup['wallet'];
  handDiceIds: string[];
}

export interface SavedGame extends Omit<DiceGameState, 'board'> {
  board: [string, Placement][];
}

export interface RoomSnapshot {
  version: 1;
  info: CasinoRoomInfo;
  participants: SavedParticipant[];
  lastOccupiedAt: number;
  lobby: LobbyCountdownState;
  game: SavedGame | null;
  boardSeed: number | null;
  roundNumber: number;
  usedBoardSeeds: number[];
  matchSeats: Seat[];
  matchParticipants: SavedMatchPlayer[] | null;
  unusedDiceIds: string[];
  completedRows: string[];
  matchResult: MatchResult | null;
  rollView: RollView | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function list<T>(value: unknown, check: (item: unknown) => item is T, max: number): value is T[] {
  return Array.isArray(value) && value.length <= max && value.every(check);
}
function gem(value: unknown): boolean { return GEM_ORDER.some(item => item === value); }
function pose(value: unknown): value is DiePose {
  return record(value) && string(value.id) && Array.isArray(value.p) && value.p.length === 3 && value.p.every(finite)
    && Array.isArray(value.q) && value.q.length === 4 && value.q.every(finite) && typeof value.stopped === 'boolean';
}
function frame(value: unknown): value is Frame {
  return record(value) && string(value.rollId) && int(value.seq) && finite(value.simMs)
    && ['collection', 'cup', 'rolling', 'settled'].includes(String(value.phase))
    && list(value.dice, pose, 5) && Array.isArray(value.hits) && value.hits.length <= 5
    && value.hits.every(hit => record(hit) && ['floor', 'wall', 'dice'].includes(String(hit.kind)) && finite(hit.strength));
}
function result(value: unknown): value is DiceResult {
  return record(value) && string(value.id) && gem(value.gem) && typeof value.approximate === 'boolean';
}
function config(value: unknown): value is RollConfig {
  return record(value) && int(value.count, 1, 5) && (value.hz === 120 || value.hz === 240);
}
function placement(value: unknown): value is Placement {
  return record(value) && int(value.row, 0, 5) && int(value.column, 0, 5) && gem(value.gem) && string(value.dieId);
}
function rollView(value: unknown): value is RollView {
  return record(value) && string(value.id) && (value.kind === 'initial' || value.kind === 'reroll')
    && config(value.config) && list(value.previous, pose, 5) && frame(value.latest)
    && list(value.results, result, 5) && typeof value.confirmed === 'boolean'
    && int(value.nudges, 0, 10) && typeof value.deadline === 'boolean';
}
function seat(value: unknown): value is Seat {
  return record(value) && string(value.id) && typeof value.name === 'string' && int(value.slot, 0, 5)
    && typeof value.ready === 'boolean' && typeof value.online === 'boolean';
}
function participant(value: unknown): value is SavedParticipant {
  return record(value) && string(value.id) && typeof value.name === 'string' && int(value.slot, 0, 5)
    && typeof value.ready === 'boolean' && typeof value.token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value.token)
    && typeof value.online === 'boolean' && (value.leftAt === null || finite(value.leftAt))
    && (value.online || value.leftAt !== null)
    && typeof value.exited === 'boolean' && (value.viewedRoll === null || string(value.viewedRoll))
    && typeof value.dev === 'boolean' && list(value.seenRequests, string, 48);
}
function savedMatchPlayer(value: unknown): value is SavedMatchPlayer {
  return record(value) && string(value.id) && int(value.score) && Array.isArray(value.wallet)
    && value.wallet.every(item => record(item) && [10, 50, 100].includes(Number(item.denomination)) && int(item.count, 0, 30))
    && list(value.handDiceIds, string, 30);
}
function matchResult(value: unknown): value is MatchResult {
  return record(value) && (value.status === 'continue' || value.status === 'won') && int(value.highestScore)
    && list(value.winners, string, 6);
}
function game(value: unknown): value is SavedGame {
  return record(value) && (value.turnId === null || string(value.turnId)) && int(value.turnSequence)
    && (value.turnNotice === null || value.turnNotice === 'no-legal-placement')
    && ['ready', 'placement', 'finished'].includes(String(value.phase))
    && int(value.revision) && config(value.config) && (value.rollId === null || string(value.rollId))
    && list(value.results, result, 5) && list(value.remaining, string, 5) && typeof value.placedThisRoll === 'boolean'
    && Array.isArray(value.board) && value.board.length <= 36 && value.board.every(entry => Array.isArray(entry)
      && entry.length === 2 && typeof entry[0] === 'string' && placement(entry[1]));
}

/** Validates durable room data before it is allowed to rebuild live state. */
function isRoomSnapshot(value: unknown, expectedInfo: CasinoRoomInfo): value is RoomSnapshot {
  if (!record(value) || value.version !== 1 || !record(value.info)
    || value.info.id !== expectedInfo.id || value.info.name !== expectedInfo.name
    || !list(value.participants, participant, 6) || !finite(value.lastOccupiedAt)
    || !record(value.lobby) || (value.lobby.startAt !== null && !finite(value.lobby.startAt))
    || !int(value.lobby.generation) || (value.lobby.startedPlayers !== null
      && !list(value.lobby.startedPlayers, seat, 6))
    || (value.game !== null && !game(value.game))
    || (value.boardSeed !== null && !int(value.boardSeed, 0, 0xffff_ffff))
    || !int(value.roundNumber, 1) || !list(value.usedBoardSeeds, item => int(item, 0, 0xffff_ffff), 10_000)
    || !list(value.matchSeats, seat, 6)
    || (value.matchParticipants !== null && !list(value.matchParticipants, savedMatchPlayer, 6))
    || !list(value.unusedDiceIds, string, 30) || !list(value.completedRows, string, 6)
    || (value.matchResult !== null && !matchResult(value.matchResult))
    || (value.rollView !== null && !rollView(value.rollView))) return false;
  if (value.game !== null && value.game.phase === 'rolling') return false;
  return true;
}

export function readRoomSnapshot(value: unknown, expectedInfo: CasinoRoomInfo): RoomSnapshot | null {
  return isRoomSnapshot(value, expectedInfo) ? value : null;
}
