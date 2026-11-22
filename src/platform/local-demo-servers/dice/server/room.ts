import { randomBytes, randomUUID } from 'node:crypto';
import { BOARD_ROWS, GEM_ORDER, boardCellKey } from '../../../../features/dice/model/geometry';
import { DEFAULT_CONFIG } from '../../../../shared/contracts/dice';
import type { ClientMessage, Frame, GameState, Placement, RollConfig, RollKind, RollView, ServerMessage } from '../../../../shared/contracts/dice';
import { PhysicsRoll } from '../../../../features/dice/server/physics';
import { RollRunner } from './roll-runner';

export const SESSION_GRACE_MS = 90_000;

export interface RoomPeer {
  send(message: ServerMessage, transient?: boolean): boolean;
  close(): void;
}

interface Member {
  id: string;
  name: string;
  token: string;
  peer: RoomPeer | null;
  leftAt: number | null;
  viewedRoll: string | null;
  dev: boolean;
  seen: Set<string>;
}

type Command = Exclude<ClientMessage, { type: 'join' }>;

export class DiceRoom {
  private members: Member[] = [];
  private turnId: string | null = null;
  private phase: GameState['phase'] = 'ready';
  private revision = 0;
  private config: RollConfig = { ...DEFAULT_CONFIG };
  private roll: RollView | null = null;
  private runner: RollRunner | null = null;
  private results: GameState['results'] = [];
  private remaining: string[] = [];
  private placedThisRoll = false;
  private board = new Map<number, Placement>();
  private lastOccupiedAt = Date.now();

  constructor(private readonly allowDev: boolean) {}

  private openColumn(row: number) {
    return GEM_ORDER.findIndex((_, column) => !this.board.has(boardCellKey(row, column)));
  }

  private hasLegalPlacement() {
    const remaining = this.results.filter(die => this.remaining.includes(die.id));
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      if (remaining.some(die => die.gem === GEM_ORDER[this.openColumn(row)])) return true;
    }
    return false;
  }

  private state(): GameState {
    return {
      seats: this.members.map(member => ({ id: member.id, name: member.name, online: member.peer !== null })),
      turnId: this.turnId, phase: this.phase, revision: this.revision, config: this.config,
      placements: [...this.board.values()], results: this.results, remaining: this.remaining,
      placedThisRoll: this.placedThisRoll, hasLegalPlacement: this.hasLegalPlacement(),
    };
  }

  private update() {
    this.broadcast({ type: 'state', state: this.state(), roll: this.roll });
  }

  private broadcast(message: ServerMessage, transient = false): boolean {
    let sent = false;
    for (const member of this.members) {
      if (message.type === 'metrics' && !member.dev) continue;
      if (member.peer?.send(message, transient)) sent = true;
    }
    return sent;
  }

  join(peer: RoomPeer, { token, dev }: Extract<ClientMessage, { type: 'join' }>) {
    let member = token ? this.members.find(item => item.token === token) : undefined;
    if (token && !member) {
      this.error(peer, 'TOKEN', '再接続の期間が終了しました。新しいプレイヤーとして参加します。');
      return null;
    }
    if (!member) {
      if (this.members.length >= 6) {
        this.error(peer, 'FULL', 'このルームの定員は6名です。');
        return null;
      }
      const name = [1, 2, 3, 4, 5, 6].map(number => `PLAYER ${number}`).find(label => !this.members.some(item => item.name === label));
      if (!name) return null;
      member = { id: randomUUID(), name, token: randomBytes(24).toString('base64url'), peer: null, leftAt: null, viewedRoll: null, dev: false, seen: new Set() };
      this.members.push(member);
    }
    const prior = member.peer;
    member.peer = peer;
    prior?.close();
    member.leftAt = null;
    member.dev = this.allowDev && dev === true;
    this.turnId ??= member.id;
    this.lastOccupiedAt = Date.now();

    peer.send({
      type: 'welcome', playerId: member.id, token: member.token, dev: member.dev,
      state: this.state(), roll: this.roll,
      view: Boolean(this.roll && !this.roll.confirmed && member.viewedRoll !== this.roll.id),
    });
    this.update();
    return member.id;
  }

  leave(playerId: string, peer: RoomPeer) {
    const member = this.members.find(item => item.id === playerId);
    if (!member || member.peer !== peer) return;
    member.peer = null;
    member.leftAt = Date.now();
    this.lastOccupiedAt = member.leftAt;
    this.update();
  }

  prune(now: number) {
    if (this.members.every(member => !member.peer)) return now - this.lastOccupiedAt >= SESSION_GRACE_MS;
    const remaining = this.members.filter(member => member.peer || member.leftAt === null || now - member.leftAt < SESSION_GRACE_MS);
    if (remaining.length === this.members.length) return false;
    this.members = remaining;
    if (!this.members.some(member => member.id === this.turnId)) {
      this.turnId = remaining.find(member => member.peer)?.id ?? null;
      this.revision += 1;
    }
    this.update();
    return false;
  }

  private error(peer: RoomPeer, code: string, message: string) {
    peer.send({ type: 'error', code, message });
  }

  private verifyTurn(member: Member, peer: RoomPeer) {
    if (member.id === this.turnId) return true;
    this.error(peer, 'TURN', '手番プレイヤーが操作できます。');
    return false;
  }

  private startRoll(kind: RollKind) {
    const previous = kind === 'reroll' ? this.roll?.latest.dice.filter(die => this.remaining.includes(die.id)) ?? [] : [];
    const ids = kind === 'initial' ? Array.from({ length: this.config.count }, (_, index) => `die-${index + 1}`) : previous.map(die => die.id);
    if (!ids.length) return;
    const id = randomUUID();
    const config = { count: ids.length, hz: this.config.hz };
    const physics = new PhysicsRoll({ rollId: id, kind, ids, hz: config.hz });
    this.roll = {
      id, kind, config, previous, latest: physics.frame(),
      results: [], confirmed: false, nudges: 0, deadline: false,
    };
    this.phase = 'rolling';
    this.update();
    this.runner = new RollRunner(physics, config.hz, config.count, {
      frame: frame => this.capture(id, frame),
      metrics: metrics => { this.broadcast({ type: 'metrics', metrics }, true); },
      finished: frame => {
        if (this.roll?.id !== id) return;
        this.roll = { ...this.roll, latest: frame, results: physics.results, nudges: physics.nudgeCount, deadline: physics.deadline };
        this.phase = 'confirm';
        this.runner = null;
        this.update();
      },
    });
    this.runner.start();
  }

  private capture(id: string, frame: Frame) {
    if (this.roll?.id !== id) return false;
    this.roll.latest = frame;
    return this.broadcast({ type: 'frame', frame }, true);
  }

  command(playerId: string, peer: RoomPeer, message: Command) {
    const member = this.members.find(item => item.id === playerId && item.peer === peer);
    if (!member) return;

    if (message.type === 'confirm') {
      if (this.roll?.id !== message.rollId || !this.roll.results.length) return;
      member.viewedRoll = message.rollId;
      if (member.id !== this.turnId || this.roll.confirmed) return;
      this.roll.confirmed = true;
      this.results = this.roll.results;
      this.remaining = this.results.map(die => die.id);
      this.placedThisRoll = false;
      this.phase = 'placement';
      this.revision += 1;
      this.update();
      return;
    }

    if (!this.verifyTurn(member, peer)) return;

    switch (message.type) {
      case 'config':
        if (!member.dev || (this.phase !== 'ready' && this.phase !== 'placement')) {
          this.error(peer, 'CONFIG', '開発設定はロールの開始前に変更できます。');
          return;
        }
        this.config = message.config;
        this.update();
        return;
      case 'roll':
      case 'reroll': {
        if (member.seen.has(message.requestId)) return;
        if ((message.type === 'roll' && this.phase !== 'ready')
          || (message.type === 'reroll' && (this.phase !== 'placement' || !this.remaining.length))) {
          this.error(peer, 'PHASE', '現在の状態では振れません。');
          return;
        }
        if (message.type === 'reroll' && !this.placedThisRoll && !member.dev) {
          this.error(peer, 'PLACE_FIRST', 'このロールで1個以上配置すると、残りを振り直せます。');
          return;
        }
        member.seen.add(message.requestId);
        if (member.seen.size > 48) {
          const first = member.seen.values().next().value;
          if (first) member.seen.delete(first);
        }
        this.startRoll(message.type === 'roll' ? 'initial' : 'reroll');
        return;
      }
      case 'place': {
        if (this.phase !== 'placement' || this.roll?.id !== message.rollId || !this.remaining.includes(message.dieId)) return;
        const die = this.results.find(item => item.id === message.dieId);
        if (!die) return;
        const column = this.openColumn(message.row);
        if (GEM_ORDER[column] !== die.gem) {
          this.error(peer, 'CELL', '行の左端の空きマスに、同じ宝石のダイスを置けます。');
          return;
        }
        this.board.set(boardCellKey(message.row, column), { row: message.row, column, gem: die.gem });
        this.remaining = this.remaining.filter(id => id !== die.id);
        this.placedThisRoll = true;
        this.revision += 1;
        this.update();
        return;
      }
      case 'end-turn': {
        if (this.phase !== 'placement' || message.revision !== this.revision) return;
        if (this.hasLegalPlacement() && !this.placedThisRoll) {
          this.error(peer, 'PLACE_FIRST', '置けるダイスがあるときは1個以上配置してください。');
          return;
        }
        const start = this.members.findIndex(item => item.id === member.id);
        const next = this.members.slice(start + 1).concat(this.members.slice(0, start + 1)).find(item => item.peer);
        this.turnId = next?.id ?? member.id;
        this.phase = 'ready';
        this.remaining = [];
        this.placedThisRoll = false;
        this.revision += 1;
        this.update();
        return;
      }
    }
  }

  dispose() {
    this.runner?.stop();
    this.runner = null;
    for (const member of this.members) member.peer?.close();
    this.members = [];
    this.roll = null;
  }
}
