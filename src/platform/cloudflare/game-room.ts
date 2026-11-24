import { readClientMessage as readLobbyMessage } from '../../shared/contracts/casino-entry';
import type { CasinoRoomInfo, ClientMessage as LobbyClientMessage, ServerMessage as LobbyServerMessage } from '../../shared/contracts/casino-entry';
import { parseRoomName } from '../../shared/contracts/casino-entry';
import { readClientMessage as readDiceMessage } from '../../shared/contracts/dice';
import type { ClientMessage as DiceClientMessage, ServerMessage as DiceServerMessage } from '../../shared/contracts/dice';
import { Room } from '../server/core/room';
import type { RoomRuntime } from '../server/core/ports';
import type { DicePeer, LobbyPeer } from '../server/core/room';
import { createCloudflareRoomRuntime } from './room-runtime';

interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface RoomObjectState {
  storage: RoomStorage;
  blockConcurrencyWhile(callback: () => Promise<void>): Promise<void>;
}

interface ConnectionBase {
  readonly socket: WebSocket;
  id: string;
  timeout: ReturnType<typeof setTimeout> | undefined;
  windowStartedAt: number;
  packets: number;
}

type Connection = (ConnectionBase & { readonly protocol: 'lobby'; readonly peer: LobbyPeer })
  | (ConnectionBase & { readonly protocol: 'dice'; readonly peer: DicePeer });

const ROOM_ID = /^[a-f0-9]{8}$/;
const MAX_SOCKETS = 64;
const MAX_MESSAGE_BYTES = 4096;
const MAX_SEND_QUEUE_BYTES = 524_288;
const MAX_TRANSIENT_QUEUE_BYTES = 98_304;
const INPUT_ERROR = { type: 'error', code: 'INPUT', message: '操作の形式を確認してください。' } as const;
interface AcceptableWebSocket extends WebSocket { accept(): void }
declare const WebSocketPair: new () => { 0: WebSocket; 1: AcceptableWebSocket };

function roomInfo(value: unknown): CasinoRoomInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !ROOM_ID.test(record.id)
    || typeof record.name !== 'string' || parseRoomName(record.name) !== record.name) return null;
  return { id: record.id, name: record.name };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export class GameRoomObject {
  private roomInfo: CasinoRoomInfo | null = null;
  private room: Room | null = null;
  private readonly runtime: RoomRuntime;
  private readonly connections = new Set<WebSocket>();
  private readonly ready: Promise<void>;

  constructor(private readonly state: RoomObjectState, runtime = createCloudflareRoomRuntime()) {
    this.runtime = runtime;
    this.ready = state.blockConcurrencyWhile(async () => {
      const saved = roomInfo(await state.storage.get<unknown>('room'));
      if (!saved) return;
      this.roomInfo = saved;
      this.room = new Room(saved, this.runtime, { mode: 'standard' });
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/__create' && request.method === 'POST') return this.create(request);
    if (!this.room || !this.roomInfo) return new Response('Room not found', { status: 404 });
    if (url.pathname !== '/casino-ws' && url.pathname !== '/dice-ws') return new Response('Not found', { status: 404 });
    if (url.searchParams.get('room') !== this.roomInfo.id) return new Response('Room not found', { status: 404 });
    if (!isSameOrigin(request)) return new Response('Forbidden', { status: 403 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (this.connections.size >= MAX_SOCKETS) return new Response('Room is full', { status: 503 });
    const protocol = url.pathname === '/casino-ws' ? 'lobby' : 'dice';
    const pair = new WebSocketPair();
    const client = pair[0];
    const socket = pair[1];
    socket.accept();
    const base = { socket, id: '', windowStartedAt: performance.now(), packets: 0,
      timeout: setTimeout(() => socket.close(1008, 'join required'), 4500) };
    const context: Connection = protocol === 'lobby'
      ? { ...base, protocol, peer: this.createLobbyPeer(socket) }
      : { ...base, protocol, peer: this.createDicePeer(socket) };
    this.connections.add(socket);
    socket.addEventListener('message', event => this.onMessage(context, event.data));
    socket.addEventListener('close', () => this.onClose(context));
    socket.addEventListener('error', () => socket.close(1011, 'socket error'));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  private async create(request: Request): Promise<Response> {
    if (this.roomInfo) return json({ error: 'Room ID collision' }, 409);
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_MESSAGE_BYTES) return json({ error: 'Invalid request' }, 400);
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_MESSAGE_BYTES) return json({ error: 'Invalid request' }, 400);
      body = JSON.parse(text);
    }
    catch { return json({ error: 'Invalid request' }, 400); }
    const info = roomInfo(body);
    if (!info) return json({ error: 'Invalid room' }, 400);
    let created = false;
    await this.state.blockConcurrencyWhile(async () => {
      const saved = roomInfo(await this.state.storage.get<unknown>('room'));
      if (saved) {
        this.roomInfo = saved;
        this.room ??= new Room(saved, this.runtime, { mode: 'standard' });
        return;
      }
      await this.state.storage.put('room', info);
      this.roomInfo = info;
      this.room = new Room(info, this.runtime, { mode: 'standard' });
      created = true;
    });
    return created ? json(info, 201) : json({ error: 'Room ID collision' }, 409);
  }

  private createLobbyPeer(socket: WebSocket): LobbyPeer {
    return {
      protocol: 'lobby',
      send: (message: LobbyServerMessage) => { this.send(socket, message); },
      close: (code, reason) => socket.close(code ?? 4001, reason),
    };
  }

  private createDicePeer(socket: WebSocket): DicePeer {
    return {
      protocol: 'dice',
      send: (message: DiceServerMessage, transient = false) => this.send(socket, message, transient),
      close: (code, reason) => socket.close(code ?? 4001, reason),
    };
  }

  private send(socket: WebSocket, message: LobbyServerMessage | DiceServerMessage, transient = false) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_SEND_QUEUE_BYTES) {
      socket.close(1013, 'send queue full');
      return false;
    }
    if (transient && socket.bufferedAmount > MAX_TRANSIENT_QUEUE_BYTES) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch { socket.close(1011, 'send failed'); return false; }
  }

  private onMessage(context: Connection, data: unknown) {
    const now = performance.now();
    if (now - context.windowStartedAt > 1000) {
      context.windowStartedAt = now;
      context.packets = 0;
    }
    if (++context.packets > 45 || typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) {
      context.socket.close(1008, 'input limit');
      return;
    }
    let value: unknown;
    try { value = JSON.parse(data); }
    catch { this.send(context.socket, INPUT_ERROR); return; }
    if (context.protocol === 'lobby') {
      const message = readLobbyMessage(value);
      if (!message) { this.send(context.socket, INPUT_ERROR); return; }
      this.onLobbyMessage(context, message);
    } else {
      const message = readDiceMessage(value);
      if (!message) { this.send(context.socket, INPUT_ERROR); return; }
      this.onDiceMessage(context, message);
    }
  }

  private onLobbyMessage(context: Extract<Connection, { protocol: 'lobby' }>, message: LobbyClientMessage) {
    const room = this.room;
    const info = this.roomInfo;
    if (!room || !info) return;
    if (!context.id) {
      if (message.type !== 'join' || message.room !== info.id) {
        this.send(context.socket, { type: 'error', code: 'NOT_FOUND', message: 'ルームが見つかりません。' });
        context.socket.close(4003, 'invalid room join');
        return;
      }
      clearTimeout(context.timeout);
      context.timeout = undefined;
      context.id = room.connectLobby(context.peer, message.token) ?? '';
      if (!context.id) context.socket.close(4003, 'join rejected');
      return;
    }
    if (message.type === 'leave') {
      room.exitLobby(context.id, context.peer);
      context.id = '';
      context.socket.close(1000, 'left room');
    } else if (message.type === 'clock' || message.type === 'ready') {
      room.commandLobby(context.id, context.peer, message);
    }
  }

  private onDiceMessage(context: Extract<Connection, { protocol: 'dice' }>, message: DiceClientMessage) {
    const room = this.room;
    const info = this.roomInfo;
    if (!room || !info) return;
    if (!context.id) {
      if (message.type !== 'join' || message.room !== info.id) {
        this.send(context.socket, { type: 'error', code: 'NOT_FOUND', message: 'ルームが見つかりません。' });
        context.socket.close(4003, 'invalid room join');
        return;
      }
      clearTimeout(context.timeout);
      context.timeout = undefined;
      context.id = room.connectDice(context.peer, { token: message.token, dev: message.dev }) ?? '';
      if (!context.id) context.socket.close(1008, 'join rejected');
      return;
    }
    if (message.type === 'join') return;
    room.commandDice(context.id, context.peer, message);
  }

  private onClose(context: Connection) {
    clearTimeout(context.timeout);
    this.connections.delete(context.socket);
    if (!context.id || !this.room) return;
    this.room.disconnect(context.id, context.peer);
  }
}
