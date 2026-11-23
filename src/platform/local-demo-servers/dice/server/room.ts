import { randomBytes, randomUUID } from 'node:crypto';
import { createGoalBoard } from '../../../../features/board/model/goal-layout';
import type { ClientMessage, Frame, GameState, RollKind, RollView, ServerMessage } from '../../../../shared/contracts/dice';
import { PhysicsRoll } from '../../../../features/dice/server/physics';
import {
  beginRoll,
  canConfigure,
  createDiceRollRequest,
  confirmRoll,
  finishRoll,
  finishTurn,
  hasLegalPlacement,
  hasTurn,
  initialDiceGameState,
  placeDie,
  selectTurnAfterPrune,
  setFirstTurn,
  setRollConfig,
  endTurnStatus,
} from '../../../server/core/dice-game';
import type { DiceGamePlayer } from '../../../server/core/dice-game';
import { reconnectGraceExpired, roomGraceExpired } from '../../../server/core/participant-lifecycle';
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
  private game = initialDiceGameState();
  private roll: RollView | null = null;
  private runner: RollRunner | null = null;
  private readonly boardSeed = randomBytes(4).readUInt32LE();
  private readonly definition = createGoalBoard(this.boardSeed);
  private lastOccupiedAt = Date.now();

  constructor(private readonly allowDev: boolean) {}

  private hasLegalPlacement() {
    return hasLegalPlacement(this.definition, this.game);
  }

  private state(): GameState {
    return {
      seats: this.members.map(member => ({ id: member.id, name: member.name, online: member.peer !== null })),
      turnId: this.game.turnId, phase: this.game.phase, revision: this.game.revision, config: this.game.config,
      boardSeed: this.boardSeed, placements: [...this.game.board.values()], results: this.game.results, remaining: this.game.remaining,
      placedThisRoll: this.game.placedThisRoll, hasLegalPlacement: this.hasLegalPlacement(),
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
    this.game = setFirstTurn(this.game, member.id);
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
    if (this.members.every(member => !member.peer)) return roomGraceExpired(this.lastOccupiedAt, now, SESSION_GRACE_MS);
    const remaining = this.members.filter(member => member.peer || !reconnectGraceExpired(member.leftAt, now, SESSION_GRACE_MS));
    if (remaining.length === this.members.length) return false;
    this.members = remaining;
    const players: DiceGamePlayer[] = remaining.map(member => ({ id: member.id, online: member.peer !== null }));
    this.game = selectTurnAfterPrune(this.game, players);
    this.update();
    return false;
  }

  private error(peer: RoomPeer, code: string, message: string) {
    peer.send({ type: 'error', code, message });
  }

  private verifyTurn(member: Member, peer: RoomPeer) {
    if (hasTurn(this.game, member.id)) return true;
    this.error(peer, 'TURN', '手番プレイヤーが操作できます。');
    return false;
  }

  private startRoll(kind: RollKind) {
    const previous = kind === 'reroll' ? this.roll?.latest.dice.filter(die => this.game.remaining.includes(die.id)) ?? [] : [];
    const id = randomUUID();
    const started = beginRoll(this.game, id, kind, this.game.config.count, previous);
    const ids = started.diceIds;
    if (!ids.length) return;
    const config = { count: ids.length, hz: this.game.config.hz };
    const physics = new PhysicsRoll({ rollId: id, kind, ids, hz: config.hz });
    this.game = started.state;
    this.roll = {
      id, kind, config, previous, latest: physics.frame(),
      results: [], confirmed: false, nudges: 0, deadline: false,
    };
    this.update();
    this.runner = new RollRunner(physics, config.hz, config.count, {
      frame: frame => this.capture(id, frame),
      metrics: metrics => { this.broadcast({ type: 'metrics', metrics }, true); },
      finished: frame => {
        if (this.roll?.id !== id) return;
        this.roll = { ...this.roll, latest: frame, results: physics.results, nudges: physics.nudgeCount, deadline: physics.deadline };
        this.game = finishRoll(this.game, id);
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
      if (this.roll.confirmed) return;
      const next = confirmRoll(this.game, member.id, message.rollId, this.roll.results);
      if (!next) return;
      this.game = next;
      this.roll = { ...this.roll, confirmed: true };
      this.update();
      return;
    }

    if (!this.verifyTurn(member, peer)) return;

    switch (message.type) {
      case 'config':
        if (!canConfigure(this.game, member.dev)) {
          this.error(peer, 'CONFIG', '開発設定はロールの開始前に変更できます。');
          return;
        }
        this.game = setRollConfig(this.game, message.config);
        this.update();
        return;
      case 'roll':
      case 'reroll': {
        const kind = message.type === 'roll' ? 'initial' : 'reroll';
        const decision = createDiceRollRequest(this.game, member.id, kind, message.requestId, member.seen, member.dev);
        if (decision.status === 'duplicate') return;
        if (decision.status === 'turn') {
          this.error(peer, 'TURN', '手番プレイヤーが操作できます。');
          return;
        }
        if (decision.status === 'phase') {
          this.error(peer, 'PHASE', '現在の状態では振れません。');
          return;
        }
        if (decision.status === 'place-first') {
          this.error(peer, 'PLACE_FIRST', 'このロールで1個以上配置すると、残りを振り直せます。');
          return;
        }
        member.seen = decision.seen;
        this.startRoll(kind);
        return;
      }
      case 'place': {
        const result = placeDie(this.game, this.definition, message);
        if (result.status === 'ignored') return;
        if (result.status === 'invalid') {
          this.error(peer, 'CELL', '行の左端の空きマスに、指定と同じ宝石のダイスを置けます。');
          return;
        }
        this.game = result.state;
        this.update();
        return;
      }
      case 'end-turn': {
        const status = endTurnStatus(this.game, this.definition, message.revision);
        if (status === 'ignored') return;
        if (status === 'place-first') {
          this.error(peer, 'PLACE_FIRST', '置けるダイスがあるときは1個以上配置してください。');
          return;
        }
        const players: DiceGamePlayer[] = this.members.map(item => ({ id: item.id, online: item.peer !== null }));
        this.game = finishTurn(this.game, players, member.id);
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
