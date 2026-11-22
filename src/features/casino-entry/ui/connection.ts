import { parseJson, readServerMessage, roomName } from '../../../shared/contracts/casino-entry';
import type { ClientMessage, LobbyState, ServerMessage } from '../../../shared/contracts/casino-entry';

export interface ConnectionView {
  status: 'connecting' | 'online' | 'offline';
  playerId: string | null;
  lobby: LobbyState | null;
  problem: string;
  clockOffset: number;
}

const HOLD: ConnectionView = {
  status: 'connecting', playerId: null, lobby: null, problem: '', clockOffset: 0,
};

export class CasinoConnection {
  readonly room: string;
  private current = HOLD;
  private socket: WebSocket | null = null;
  private retry: number | undefined;
  private delay = 290;
  private active = false;
  private ping: number | undefined;
  private sentAt = 0;
  private token: string | undefined;
  private listeners = new Set<() => void>();
  private readonly key: string;

  constructor(room: string) {
    this.room = roomName(room);
    this.key = `atelier-noir-casino-entry:${this.room}`;
    try { this.token = sessionStorage.getItem(this.key) ?? undefined; }
    catch { this.token = undefined; }
  }

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<ConnectionView>) {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }

  hasSession() { return Boolean(this.token); }

  private clearToken() {
    this.token = undefined;
    try { sessionStorage.removeItem(this.key); }
    catch { return false; }
    return true;
  }

  exit() {
    this.send({ type: 'leave' });
    this.stop();
    this.clearToken();
    this.update(HOLD);
  }

  setReady(ready: boolean) {
    if (this.current.status !== 'online' || this.current.lobby?.phase === 'started') return;
    this.send({ type: 'ready', ready });
  }

  private syncClock() {
    this.sentAt = Date.now();
    this.send({ type: 'clock', sentAt: this.sentAt });
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop() {
    this.active = false;
    window.clearTimeout(this.retry);
    window.clearInterval(this.ping);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private connect() {
    if (!this.active) return;
    this.update({ status: 'connecting' });
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/casino-ws`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.send({ type: 'join', room: this.room, token: this.token });
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const message = readServerMessage(parseJson(event.data));
      if (message) this.receive(message);
    });
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return;
      this.socket = null;
      window.clearInterval(this.ping);
      this.update({ status: 'offline' });
      if (!this.active || event.code === 4001 || event.code === 4003) return;
      this.retry = window.setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(3000, this.delay * 1.7);
    });
  }

  private receive(message: ServerMessage) {
    switch (message.type) {
      case 'welcome':
        this.delay = 290;
        this.token = message.token;
        try { sessionStorage.setItem(this.key, message.token); }
        catch { this.update({ problem: 'このタブを開いたまま再接続できます。' }); }
        this.update({
          status: 'online', playerId: message.playerId, lobby: message.state, problem: '',
          clockOffset: message.state.serverTime - Date.now(),
        });
        if (message.state.phase !== 'started') {
          this.syncClock();
          this.ping = window.setInterval(() => this.syncClock(), 8000);
        }
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
        if (message.code === 'TOKEN') this.clearToken();
        this.update({ problem: message.message });
    }
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
}
