import { parseJson, readServerMessage, roomName } from '../../../shared/contracts/dice';
import type { ClientMessage, Frame, GameState, Impact, MatchPlayerSetup, MatchSetup, MatchSettlementEvent, Metrics, RollView, ServerMessage } from '../../../shared/contracts/dice';
import { confirmedPlacement } from '../model/placement-feedback';
import type { PlacementFeedback } from '../model/placement-feedback';
import { SettlementEventQueue } from '../model/settlement-event-queue';
import { acceptsGameState } from '../model/state-sync';

interface Sample { frame: Frame; arrived: number }

export class FrameStream {
  private samples: Sample[] = [];
  private shown = 0;

  push(frame: Frame, arrived = performance.now()) {
    const latest = this.samples.at(-1)?.frame;
    if (latest?.rollId !== frame.rollId) {
      this.samples = [];
      this.shown = 0;
    }
    else if (latest.seq >= frame.seq) return false;
    this.samples.push({ frame, arrived });
    if (this.samples.length > 12) this.samples.shift();
    return true;
  }

  sample(rollId: string, time: number) {
    const last = this.samples.at(-1);
    const first = this.samples[0];
    if (!first || !last || last.frame.rollId !== rollId) return null;
    if (last.frame.phase === 'settled') return { a: last.frame, b: last.frame, blend: 0, time: last.frame.simMs };
    const ms = Math.max(first.frame.simMs, this.shown, Math.min(last.frame.simMs, last.frame.simMs + time - last.arrived - 55));
    this.shown = ms;
    let a = first.frame;
    for (const { frame: b } of this.samples) {
      if (b.simMs >= ms) {
        const blend = b.simMs > a.simMs ? (ms - a.simMs) / (b.simMs - a.simMs) : 0;
        return { a, b, blend, time: ms };
      }
      a = b;
    }
    return { a, b: a, blend: 0, time: ms };
  }
}

interface SettlementSnapshot {
  game: GameState;
  player: MatchPlayerSetup;
}

export interface ConnectionView {
  status: 'connecting' | 'online' | 'offline';
  playerId: string | null;
  dev: boolean;
  game: GameState | null;
  settlementSnapshot: SettlementSnapshot | null;
  match: MatchSetup | null;
  settlements: readonly MatchSettlementEvent[];
  roll: RollView | null;
  tray: string | null;
  problem: string;
  metrics: Metrics | null;
  pending: boolean;
  placement: PlacementFeedback | null;
}

const HOLD: ConnectionView = {
  status: 'connecting', playerId: null, dev: false, game: null, settlementSnapshot: null, match: null, settlements: [], roll: null, tray: null,
  problem: '', metrics: null, pending: false, placement: null,
};

export class DiceConnection {
  readonly room: string;
  readonly frames = new FrameStream();
  private current = HOLD;
  private socket: WebSocket | null = null;
  private retry: number | undefined;
  private delay = 290;
  private active = false;
  private token: string | undefined;
  private listeners = new Set<() => void>();
  private impactListeners = new Set<(hits: readonly Impact[]) => void>();
  private settlementQueue = new SettlementEventQueue();
  private settlementSnapshots = new Map<string, SettlementSnapshot>();
  private readonly key: string;

  constructor(private readonly development: boolean, room: string, initialToken?: string) {
    this.room = roomName(room);
    this.key = `atelier-noir-dice:${this.room}`;
    try { this.token = initialToken ?? sessionStorage.getItem(this.key) ?? undefined; }
    catch { this.token = undefined; }
  }

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribeImpacts = (listener: (hits: readonly Impact[]) => void) => {
    this.impactListeners.add(listener);
    return () => { this.impactListeners.delete(listener); };
  };

  completeSettlement(event: MatchSettlementEvent) {
    if (!this.settlementQueue.complete(event)) return;
    this.settlementSnapshots.delete(`${event.boardSeed}:${event.revision}`);
    const next = this.settlementQueue.getSnapshot()[0];
    this.update({ settlements: this.settlementQueue.getSnapshot(),
      settlementSnapshot: next ? this.settlementSnapshots.get(`${next.boardSeed}:${next.revision}`) ?? null : null });
  }

  private update(patch: Partial<ConnectionView>) {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop() {
    this.active = false;
    window.clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private connect() {
    if (!this.active) return;
    this.update({ status: 'connecting' });
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/dice-ws`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.send({ type: 'join', room: this.room, token: this.token, dev: this.development });
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const message = readServerMessage(parseJson(event.data));
      if (message) this.receive(message);
    });
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.update({ status: 'offline', pending: false });
      if (!this.active || event.code === 4001) return;
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
        if (message.roll) this.frames.push(message.roll.latest);
        this.settlementQueue.clearPending();
        this.settlementSnapshots.clear();
        this.update({
          status: 'online', playerId: message.playerId, game: message.state, settlementSnapshot: null, roll: message.roll,
          dev: message.dev, match: message.match ?? null, settlements: this.settlementQueue.getSnapshot(), tray: message.view ? message.roll?.id ?? null : null,
          pending: false, problem: '', placement: null,
        });
        break;
      case 'state': {
        if (!acceptsGameState(this.current.game, message.state)) return;
        const newRoll = message.roll?.id !== this.current.roll?.id;
        const nextMatch = message.match ?? this.current.match;
        let settlements = this.current.settlements;
        let settlementSnapshot = this.current.settlementSnapshot;
        const settlement = message.settlement;
        if (settlement && this.current.match) {
          const player = message.match?.players.find(item => item.id === settlement.playerId);
          if (player && this.settlementQueue.enqueue(settlement)) {
            const snapshot = { game: message.state, player };
            this.settlementSnapshots.set(`${settlement.boardSeed}:${settlement.revision}`, snapshot);
            if (this.settlementQueue.getSnapshot()[0] === settlement) settlementSnapshot = snapshot;
          }
          settlements = this.settlementQueue.getSnapshot();
        }
        if (message.roll) this.frames.push(message.roll.latest);
        const placement = this.current.game?.boardSeed === message.state.boardSeed
          ? confirmedPlacement(this.current.game, message.state) ?? this.current.placement
          : null;
        this.update({
          game: message.state, settlementSnapshot, match: nextMatch, settlements, roll: message.roll, pending: false, placement,
          tray: newRoll ? message.roll?.id ?? null : this.current.tray,
          metrics: newRoll ? null : this.current.metrics,
          problem: '',
        });
        break;
      }
      case 'frame':
        if (message.frame.rollId !== this.current.roll?.id || !this.frames.push(message.frame)) return;
        if (this.current.tray === message.frame.rollId && message.frame.hits.length) {
          for (const listener of this.impactListeners) listener(message.frame.hits);
        }
        break;
      case 'metrics':
        this.update({ metrics: message.metrics });
        break;
      case 'error':
        if (message.code === 'TOKEN') {
          this.token = undefined;
          try { sessionStorage.removeItem(this.key); }
          catch { this.update({ problem: 'このタブの接続を再開します。' }); }
        }
        this.update({ pending: false, problem: message.message });
    }
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  roll(kind: 'roll' | 'reroll') {
    if (this.current.pending || this.current.status !== 'online') return;
    const requestId = globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (this.send({ type: kind, requestId, turnSequence: this.current.game?.turnSequence })) this.update({ pending: true, problem: '' });
  }

  confirm(rollId: string) {
    if (this.current.pending || this.current.status !== 'online' || this.current.tray !== rollId
      || this.current.roll?.id !== rollId || !this.current.roll.results.length) return false;
    if (this.current.match && (this.current.game?.turnId !== this.current.playerId || this.current.roll.confirmed)) return false;
    if (!this.send({ type: 'confirm', rollId })) return false;
    this.update(this.current.match ? { pending: true, problem: '' } : { tray: null });
    return true;
  }

  dismissConfirmedRoll(rollId: string) {
    if (this.current.tray === rollId && this.current.roll?.id === rollId && this.current.roll.confirmed) this.update({ tray: null });
  }
}
