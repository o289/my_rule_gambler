import { parseJson, parseRoomId, parseRoomName, readServerMessage } from '../../../shared/contracts/casino-entry';
import type { CasinoRoomInfo, ClientMessage, LobbyState, ServerMessage } from '../../../shared/contracts/casino-entry';

export interface ConnectionView {
  status: 'idle' | 'connecting' | 'online' | 'offline';
  playerId: string | null;
  room: CasinoRoomInfo | null;
  lobby: LobbyState | null;
  problem: string;
  clockOffset: number;
}

export type Admission = { ok: true; room: CasinoRoomInfo } | { ok: false; problem: string };

export interface CasinoRoomTransport {
  getSnapshot(): ConnectionView;
  subscribe(listener: () => void): () => void;
  create(name: string): Promise<Admission>;
  join(roomId: string): Promise<Admission>;
  restore(roomId?: string): Promise<Admission> | undefined;
  setReady(ready: boolean): void;
  exit(): void;
  stop(): void;
}

const HOLD: ConnectionView = {
  status: 'idle', playerId: null, room: null, lobby: null, problem: '', clockOffset: 0,
};

const SESSION_ROOM = 'atelier-noir-casino-entry-last-room';
const NO_CONNECTION = 'ルームに接続できませんでした。もう一度お試しください。';
const ADMISSION_TIMEOUT_MS = 6000;
export const casinoTokenStorageKey = (room: string) => `atelier-noir-casino-entry:${room}`;

type Join = Extract<ClientMessage, { type: 'join' }>;
type Access = Extract<ClientMessage, { type: 'create' | 'join' }>;
type Session = { roomId: string; token: string };
type Pending = { complete: (result: Admission) => void; timeout: number };

export class CasinoConnection implements CasinoRoomTransport {
  private current = HOLD;
  private socket: WebSocket | null = null;
  private retry: number | undefined;
  private delay = 290;
  private ping: number | undefined;
  private sentAt = 0;
  private session: Session | null = null;
  private pending: Pending | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly url: string) {}

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<ConnectionView>) {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }

  create(input: string): Promise<Admission> {
    const name = parseRoomName(input);
    return name ? this.admit({ type: 'create', name })
      : Promise.resolve({ ok: false, problem: 'ルーム名を1〜32文字で入力してください。' });
  }

  join(input: string): Promise<Admission> {
    const room = parseRoomId(input);
    return room ? this.admit({ type: 'join', room })
      : Promise.resolve({ ok: false, problem: 'ルームIDを半角英数字で入力してください。' });
  }

  restore(hint?: string) {
    try {
      const input = hint ?? sessionStorage.getItem(SESSION_ROOM);
      const room = input && parseRoomId(input);
      if (!room) return undefined;
      const token = sessionStorage.getItem(casinoTokenStorageKey(room));
      return token ? this.admit({ type: 'join', room, token }) : undefined;
    } catch {
      return undefined;
    }
  }

  private admit(request: Access): Promise<Admission> {
    if (this.pending || this.session) return Promise.resolve({ ok: false, problem: 'ルームへの接続を処理中です。' });
    this.delay = 290;
    return new Promise(resolve => {
      const pending = { complete: resolve, timeout: window.setTimeout(() => this.reject(NO_CONNECTION), ADMISSION_TIMEOUT_MS) };
      this.pending = pending;
      this.update({ ...HOLD, status: 'connecting' });
      if (this.pending === pending) this.connect(request);
    });
  }

  private finishAdmission(result: Admission) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    window.clearTimeout(pending.timeout);
    pending.complete(result);
  }

  private reject(problem: string) {
    this.disconnect();
    this.finishAdmission({ ok: false, problem });
    this.update(HOLD);
  }

  private remember(session: Session) {
    try {
      sessionStorage.setItem(casinoTokenStorageKey(session.roomId), session.token);
      sessionStorage.setItem(SESSION_ROOM, session.roomId);
    } catch {
      // The live connection still retains the token when storage is unavailable.
    }
  }

  private forget(roomId: string) {
    try {
      sessionStorage.removeItem(casinoTokenStorageKey(roomId));
      if (sessionStorage.getItem(SESSION_ROOM) === roomId) sessionStorage.removeItem(SESSION_ROOM);
    } catch {
      // Removing the live session still prevents another reconnect.
    }
  }

  exit() {
    const id = this.session?.roomId ?? this.current.room?.id;
    if (id) this.forget(id);
    this.send({ type: 'leave' });
    this.stop();
  }

  stop() {
    this.session = null;
    this.disconnect();
    this.finishAdmission({ ok: false, problem: NO_CONNECTION });
    this.update(HOLD);
  }

  private disconnect() {
    window.clearTimeout(this.retry);
    window.clearInterval(this.ping);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  setReady(ready: boolean) {
    if (this.current.status === 'online' && this.current.lobby?.phase !== 'started') this.send({ type: 'ready', ready });
  }

  private syncClock() {
    this.sentAt = Date.now();
    this.send({ type: 'clock', sentAt: this.sentAt });
  }

  private reconnect() {
    this.update({ status: 'offline' });
    const session = this.session;
    if (!session) return;
    const request: Join = { type: 'join', room: session.roomId, token: session.token };
    this.retry = window.setTimeout(() => {
      if (this.session !== session) return;
      this.update({ status: 'connecting' });
      this.connect(request);
    }, this.delay);
    this.delay = Math.min(3000, this.delay * 1.7);
  }

  private connect(request: Access) {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      if (this.pending) this.reject(NO_CONNECTION);
      else this.reconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket === socket) this.send(request);
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const message = readServerMessage(parseJson(event.data));
      if (message) this.receive(message, request);
    });
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return;
      this.socket = null;
      window.clearInterval(this.ping);
      if (this.pending) {
        this.reject(NO_CONNECTION);
        return;
      }
      if (event.code === 4001 || event.code === 4003) {
        this.session = null;
        this.update({ status: 'offline', problem: this.current.problem || 'このルームの接続が終了しました。' });
        return;
      }
      this.reconnect();
    });
  }

  private receive(message: ServerMessage, request: Access) {
    switch (message.type) {
      case 'welcome':
        this.delay = 290;
        this.session = { roomId: message.room.id, token: message.token };
        this.remember(this.session);
        this.update({
          status: 'online', playerId: message.playerId, room: message.room, lobby: message.state, problem: '',
          clockOffset: message.state.serverTime - Date.now(),
        });
        if (message.state.phase !== 'started') {
          this.syncClock();
          this.ping = window.setInterval(() => this.syncClock(), 8000);
        }
        this.finishAdmission({ ok: true, room: message.room });
        break;
      case 'clock': {
        const arrived = Date.now();
        if (message.sentAt === this.sentAt && arrived >= this.sentAt && arrived - this.sentAt <= 800) {
          this.update({ clockOffset: message.serverNow - (this.sentAt + arrived) / 2 });
        }
        break;
      }
      case 'state':
        if (message.state.phase === 'started') window.clearInterval(this.ping);
        else if (message.state.startAt !== this.current.lobby?.startAt) this.syncClock();
        this.update({ lobby: message.state, problem: '' });
        break;
      case 'error':
        if (message.code === 'TOKEN' && request.type === 'join') this.forget(request.room);
        if (this.pending) this.reject(message.message);
        else this.update({ problem: message.message });
        break;
    }
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
