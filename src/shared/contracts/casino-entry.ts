export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const COUNTDOWN_MS = 3000;

export interface Seat { id: string; name: string; online: boolean; slot: number; ready: boolean }
export interface LobbyState {
  seats: readonly Seat[];
  phase: 'waiting' | 'countdown' | 'started';
  hostId: string | null;
  startAt: number | null;
  serverTime: number;
}

export type ClientMessage =
  | { type: 'join'; room: string; token?: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'leave' }
  | { type: 'clock'; sentAt: number };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; token: string; state: LobbyState }
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

export function roomName(input: string) {
  const value = input.trim().toLowerCase();
  return roomPattern.test(value) ? value : 'salon';
}

export function readClientMessage(value: unknown): ClientMessage | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'join':
      return typeof value.room === 'string' && roomPattern.test(value.room) && (value.token === undefined || token(value.token))
        ? { type: 'join', room: value.room, token: value.token } : null;
    case 'ready': return typeof value.ready === 'boolean' ? { type: 'ready', ready: value.ready } : null;
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
    && (value.hostId === null || id(value.hostId)) && int(value.serverTime)
    && (value.phase === 'countdown' ? int(value.startAt)
      : (value.phase === 'waiting' || value.phase === 'started') && value.startAt === null);
}

export function readServerMessage(value: unknown): ServerMessage | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'welcome':
      return id(value.playerId) && token(value.token) && lobbyState(value.state)
        ? { type: 'welcome', playerId: value.playerId, token: value.token, state: value.state } : null;
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
