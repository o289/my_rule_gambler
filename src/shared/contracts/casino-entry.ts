import { isGameRules } from './game-rules';
import type { GameRules } from './game-rules';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const COUNTDOWN_MS = 3000;
export const ROOM_NAME_MAX = 32;
export const ROOM_ID_MAX = 32;

export interface CasinoRoomInfo { id: string; name: string }

export interface Seat { id: string; name: string; online: boolean; slot: number; ready: boolean }
export interface LobbyState {
  seats: readonly Seat[];
  /** Participants in their frozen seat order at the instant the room starts. */
  startedPlayers: readonly Seat[] | null;
  phase: 'waiting' | 'countdown' | 'started';
  hostId: string | null;
  startAt: number | null;
  serverTime: number;
  rules: GameRules;
  rulesRevision: number;
}

export type ClientMessage =
  | { type: 'create'; name?: string }
  | { type: 'join'; room: string; token?: string }
  | { type: 'ready'; ready: boolean; rulesRevision?: number }
  | { type: 'set-rules'; rules: GameRules; rulesRevision: number }
  | { type: 'leave' }
  | { type: 'clock'; sentAt: number };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; token: string; room: CasinoRoomInfo; state: LobbyState }
  | { type: 'state'; state: LobbyState }
  | { type: 'clock'; sentAt: number; serverNow: number }
  | { type: 'error'; code: string; message: string };

const roomPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const idPattern = /^[A-Za-z0-9-]{1,80}$/;
const tokenPattern = /^[A-Za-z0-9_-]{32}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): value is string { return typeof value === 'string' && idPattern.test(value); }
function token(value: unknown): value is string { return typeof value === 'string' && tokenPattern.test(value); }
function int(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function parseRoomId(input: string) {
  const value = input.trim().toLowerCase();
  return roomPattern.test(value) ? value : null;
}

export function parseRoomName(input: string) {
  const value = input.trim();
  return value.length > 0 && value.length <= ROOM_NAME_MAX && !/\p{Cc}/u.test(value) ? value : null;
}

function roomInfo(value: unknown): value is CasinoRoomInfo {
  return record(value) && typeof value.id === 'string' && parseRoomId(value.id) === value.id
    && typeof value.name === 'string' && parseRoomName(value.name) === value.name;
}

export function readClientMessage(value: unknown): ClientMessage | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'create': {
      if (value.name === undefined) return { type: 'create' };
      const name = typeof value.name === 'string' ? parseRoomName(value.name) : null;
      return name ? { type: 'create', name } : null;
    }
    case 'join': {
      const room = typeof value.room === 'string' ? parseRoomId(value.room) : null;
      return room && (value.token === undefined || token(value.token))
        ? { type: 'join', room, token: value.token } : null;
    }
    case 'ready': return typeof value.ready === 'boolean' && (value.rulesRevision === undefined || int(value.rulesRevision))
      ? { type: 'ready', ready: value.ready, rulesRevision: value.rulesRevision ?? 0 } : null;
    case 'set-rules': return isGameRules(value.rules) && int(value.rulesRevision)
      ? { type: 'set-rules', rules: value.rules, rulesRevision: value.rulesRevision } : null;
    case 'leave': return { type: 'leave' };
    case 'clock': return int(value.sentAt) ? { type: 'clock', sentAt: value.sentAt } : null;
    default: return null;
  }
}

function seat(value: unknown): value is Seat {
  return record(value) && id(value.id) && typeof value.name === 'string' && typeof value.online === 'boolean'
    && typeof value.ready === 'boolean' && int(value.slot, MAX_PLAYERS - 1);
}

function lobbyState(value: unknown): value is LobbyState {
  return record(value) && Array.isArray(value.seats) && value.seats.length <= MAX_PLAYERS && value.seats.every(seat)
    && (value.startedPlayers === null || Array.isArray(value.startedPlayers) && value.startedPlayers.length >= MIN_PLAYERS
      && value.startedPlayers.length <= MAX_PLAYERS && value.startedPlayers.every(seat))
    && (value.hostId === null || id(value.hostId)) && int(value.serverTime)
    && isGameRules(value.rules) && int(value.rulesRevision)
    && (value.phase === 'countdown' ? int(value.startAt) && value.startedPlayers === null
      : value.phase === 'waiting' ? value.startAt === null && value.startedPlayers === null
        : value.phase === 'started' && value.startAt === null && value.startedPlayers !== null);
}

export function readServerMessage(value: unknown): ServerMessage | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'welcome':
      return id(value.playerId) && token(value.token) && roomInfo(value.room) && lobbyState(value.state)
        ? { type: 'welcome', playerId: value.playerId, token: value.token, room: value.room, state: value.state } : null;
    case 'state': return lobbyState(value.state) ? { type: 'state', state: value.state } : null;
    case 'clock':
      return int(value.sentAt) && int(value.serverNow) ? { type: 'clock', sentAt: value.sentAt, serverNow: value.serverNow } : null;
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
