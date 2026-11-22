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
export interface Placement { row: number; column: number; gem: GemId }
export interface GameState {
  seats: readonly Seat[];
  turnId: string | null;
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
  | { type: 'roll' | 'reroll'; requestId: string }
  | { type: 'confirm'; rollId: string }
  | { type: 'config'; config: RollConfig }
  | { type: 'place'; rollId: string; dieId: string; row: number; column?: number }
  | { type: 'end-turn'; revision: number };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; token: string; dev: boolean; view: boolean; state: GameState; roll: RollView | null }
  | { type: 'state'; state: GameState; roll: RollView | null }
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
      return id(value.requestId) ? { type: value.type, requestId: value.requestId } : null;
    case 'confirm':
      return id(value.rollId) ? { type: 'confirm', rollId: value.rollId } : null;
    case 'config':
      return config(value.config) ? { type: 'config', config: value.config } : null;
    case 'place':
      return id(value.rollId) && id(value.dieId) && int(value.row, 0, BOARD_ROWS - 1)
        && (value.column === undefined || int(value.column, 0, GEM_ORDER.length - 1))
        ? { type: 'place', rollId: value.rollId, dieId: value.dieId, row: value.row, column: value.column } : null;
    case 'end-turn':
      return int(value.revision) ? { type: 'end-turn', revision: value.revision } : null;
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
  return record(value) && int(value.row, 0, BOARD_ROWS - 1) && int(value.column, 0, GEM_ORDER.length - 1) && gem(value.gem);
}
function gameState(value: unknown): value is GameState {
  return record(value) && listOf(value.seats, seat, 6) && (value.turnId === null || id(value.turnId))
    && ['ready', 'rolling', 'confirm', 'placement'].some(phase => phase === value.phase)
    && int(value.revision) && config(value.config)
    && (value.boardSeed === undefined || int(value.boardSeed, 0, 0xffff_ffff))
    && listOf(value.placements, placement, BOARD_ROWS * GEM_ORDER.length)
    && listOf(value.results, diceResult, 5) && listOf(value.remaining, id, 5)
    && typeof value.placedThisRoll === 'boolean' && typeof value.hasLegalPlacement === 'boolean';
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
        ? { type: 'state', state: value.state, roll: value.roll } : null;
    case 'welcome':
      return id(value.playerId) && typeof value.token === 'string' && tokenPattern.test(value.token)
        && typeof value.dev === 'boolean' && typeof value.view === 'boolean'
        && gameState(value.state) && (value.roll === null || rollView(value.roll))
        ? { type: 'welcome', playerId: value.playerId, token: value.token, dev: value.dev, view: value.view, state: value.state, roll: value.roll }
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
