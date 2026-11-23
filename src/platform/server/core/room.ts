import { COUNTDOWN_MS, MAX_PLAYERS } from '../../../shared/contracts/casino-entry';
import type { CasinoRoomInfo, LobbyState, ServerMessage as LobbyMessage } from '../../../shared/contracts/casino-entry';
import type { ClientMessage as DiceClientMessage, DiceResult, Frame, GameState, RollKind, RollView, ServerMessage as DiceMessage } from '../../../shared/contracts/dice';
import { createGoalBoard } from '../../../features/board/model/goal-layout';
import type { BoardDefinition } from '../../../features/board/model/board-model';
import {
  beginRoll,
  canConfigure,
  createDiceRollRequest,
  confirmRoll,
  endTurnStatus,
  finishRoll,
  finishTurn,
  hasLegalPlacement,
  hasTurn,
  initialDiceGameState,
  placeDie,
  selectTurnAfterPrune,
  setFirstTurn,
  setRollConfig,
} from './dice-game';
import type { DiceGamePlayer, DiceGameState } from './dice-game';
import {
  cancelLobbyCountdown,
  createLobbyState,
  initialLobbyCountdownState,
  resolveLobbyCountdown,
  scheduleLobbyCountdown,
  updateLobbyReady,
} from './lobby';
import type { LobbyCountdownState, LobbyParticipant } from './lobby';
import { availableSeatSlot, reconnectGraceExpired, roomGraceExpired } from './participant-lifecycle';
import type { RoomRuntime, RollSession, TimerHandle } from './ports';

export const ROOM_SESSION_GRACE_MS = 90_000;
export const PREVIEW_ROOM_PREFIX = 'dice-preview:';

export interface LobbyPeer {
  readonly protocol: 'lobby';
  send(message: LobbyMessage): void;
  close(code?: number, reason?: string): void;
}

export interface DicePeer {
  readonly protocol: 'dice';
  send(message: DiceMessage, transient?: boolean): boolean;
  close(code?: number, reason?: string): void;
}

export type RoomPeer = LobbyPeer | DicePeer;
export type RoomMode = 'standard' | 'preview';

interface Participant {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  token: string;
  peer: RoomPeer | null;
  leftAt: number | null;
  exited: boolean;
  viewedRoll: string | null;
  dev: boolean;
  seenRequests: Set<string>;
}

type LobbyCommand = { type: 'ready'; ready: boolean } | { type: 'clock'; sentAt: number };
type DiceCommand = Exclude<DiceClientMessage, { type: 'join' }>;

export interface RoomOptions {
  readonly mode: RoomMode;
  readonly countdownMs?: number;
}

export class Room {
  private participants: Participant[] = [];
  private lastOccupiedAt: number;
  private countdown: TimerHandle | null = null;
  private lobby: LobbyCountdownState = initialLobbyCountdownState();
  private game: DiceGameState | null = null;
  private boardSeed: number | null = null;
  private boardDefinition: BoardDefinition | null = null;
  private rollView: RollView | null = null;
  private rollSession: RollSession | null = null;
  private disposed = false;
  readonly mode: RoomMode;

  constructor(readonly info: CasinoRoomInfo, private readonly runtime: RoomRuntime, options: RoomOptions) {
    this.mode = options.mode;
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS;
    this.lastOccupiedAt = runtime.now();
    if (this.mode === 'preview') this.initializeGame();
  }

  private readonly countdownMs: number;

  get empty() { return this.participants.length === 0; }
  get started() { return this.lobby.startedPlayers !== null; }

  private lobbyParticipants(): LobbyParticipant[] {
    return this.participants.map(({ id, name, slot, ready, peer }) => ({ id, name, slot, ready, online: peer !== null }));
  }

  private lobbyState(): LobbyState {
    return createLobbyState(this.lobbyParticipants(), this.lobby, this.runtime.now());
  }

  private dicePlayers(): DiceGamePlayer[] {
    const order = this.mode === 'standard'
      ? this.lobby.startedPlayers?.map(seat => seat.id) ?? []
      : this.participants.map(participant => participant.id);
    return order.flatMap(id => {
      const participant = this.participants.find(item => item.id === id);
      return participant ? [{ id, online: participant.peer !== null }] : [];
    });
  }

  private gameState(): GameState | null {
    if (!this.game) return null;
    const players = this.mode === 'standard'
      ? this.lobby.startedPlayers ?? []
      : this.participants.map(({ id, name, slot, ready, peer }) => ({ id, name, slot, ready, online: peer !== null }));
    const seats = players.map(player => {
      const participant = this.participants.find(item => item.id === player.id);
      return { id: player.id, name: player.name, online: participant?.peer !== null && participant !== undefined };
    });
    return {
      seats,
      turnId: this.game.turnId,
      phase: this.game.phase,
      revision: this.game.revision,
      config: this.game.config,
      boardSeed: this.boardSeed ?? undefined,
      placements: [...this.game.board.values()],
      results: this.game.results,
      remaining: this.game.remaining,
      placedThisRoll: this.game.placedThisRoll,
      hasLegalPlacement: this.boardDefinition ? hasLegalPlacement(this.boardDefinition, this.game) : false,
    };
  }

  private initializeGame() {
    if (this.game) return false;
    this.boardSeed = this.runtime.createBoardSeed();
    this.boardDefinition = createGoalBoard(this.boardSeed);
    this.game = initialDiceGameState();
    const firstId = this.mode === 'standard' ? this.lobby.startedPlayers?.[0]?.id : this.participants[0]?.id;
    if (firstId) this.game = setFirstTurn(this.game, firstId);
    return true;
  }

  private publish() {
    const lobbyState = this.lobbyState();
    const diceState = this.gameState();
    for (const participant of this.participants) {
      const peer = participant.peer;
      if (!peer) continue;
      if (peer.protocol === 'lobby') peer.send({ type: 'state', state: lobbyState });
      else if (diceState) peer.send({ type: 'state', state: diceState, roll: this.rollView });
    }
  }

  private assignParticipant(peer: RoomPeer, token?: string, dev = false) {
    if (this.disposed) return { participant: null, error: { code: 'ROOM_CLOSED', message: 'このルームは終了しています。' } };
    let participant = token ? this.participants.find(item => item.token === token) : undefined;
    if (token && (!participant || participant.exited)) {
      return { participant: null, error: { code: 'TOKEN', message: '前回のセッションは終了しています。' } };
    }
    if (participant?.peer === null && reconnectGraceExpired(participant.leftAt, this.runtime.now(), ROOM_SESSION_GRACE_MS)) {
      return { participant: null, error: { code: 'TOKEN', message: '前回のセッションは終了しています。' } };
    }
    if (!participant) {
      const slot = availableSeatSlot(this.participants, MAX_PLAYERS);
      if (slot === null) return { participant: null, error: { code: 'FULL', message: 'このルームの定員は6名です。' } };
      participant = {
        id: this.runtime.createPlayerId(), name: `PLAYER ${slot + 1}`, slot, ready: false,
        token: this.runtime.createToken(), peer: null, leftAt: null, exited: false,
        viewedRoll: null, dev: false, seenRequests: new Set(),
      };
      this.participants.push(participant);
    }
    const previous = participant.peer;
    participant.peer = peer;
    participant.leftAt = null;
    participant.dev = this.mode === 'preview' && this.runtime.allowPreviewDev && dev;
    this.lastOccupiedAt = this.runtime.now();
    return { participant, previous, error: null };
  }

  connectLobby(peer: LobbyPeer, token?: string) {
    if (!token && this.started) {
      peer.send({ type: 'error', code: 'STARTED', message: 'このルームはすでにゲームを開始しています。' });
      return null;
    }
    const joined = this.assignParticipant(peer, token);
    if (!joined.participant) {
      const code = joined.error?.code ?? 'JOIN';
      const message = joined.error?.message ?? 'ルームに参加できません。';
      peer.send({ type: 'error', code, message });
      return null;
    }
    const participant = joined.participant;
    joined.previous?.close(4001, 'session replaced');
    if (!joined.previous && !this.cancelCountdown()) this.checkReady();
    peer.send({
      type: 'welcome', playerId: participant.id, token: participant.token,
      room: this.info, state: this.lobbyState(),
    });
    this.publish();
    return participant.id;
  }

  connectDice(peer: DicePeer, options: { token?: string; dev?: boolean }) {
    if (this.mode === 'standard') {
      if (!this.started || !this.game) {
        peer.send({ type: 'error', code: 'NOT_STARTED', message: '対戦はまだ始まっていません。' });
        return null;
      }
      if (!options.token) {
        peer.send({ type: 'error', code: 'TOKEN', message: '開始した本人の接続情報が必要です。' });
        return null;
      }
      const member = this.participants.find(item => item.token === options.token && !item.exited);
      if (!member || !this.lobby.startedPlayers?.some(seat => seat.id === member.id)) {
        peer.send({ type: 'error', code: 'PARTICIPANT', message: 'この席は対戦に参加していません。' });
        return null;
      }
    }
    const joined = this.assignParticipant(peer, options.token, options.dev === true);
    if (!joined.participant) {
      peer.send({ type: 'error', ...(joined.error ?? { code: 'JOIN', message: 'ルームに参加できません。' }) });
      return null;
    }
    const participant = joined.participant;
    joined.previous?.close(4001, 'session replaced');
    if (!this.game) return null;
    if (!this.game.turnId) this.game = setFirstTurn(this.game, participant.id);
    const state = this.gameState();
    if (!state) return null;
    peer.send({
      type: 'welcome', playerId: participant.id, token: participant.token, dev: participant.dev,
      state, roll: this.rollView,
      view: Boolean(this.rollView && !this.rollView.confirmed && participant.viewedRoll !== this.rollView.id),
    });
    this.publish();
    return participant.id;
  }

  private cancelCountdown() {
    const active = this.lobby.startAt !== null;
    if (this.countdown !== null) this.runtime.cancelTimer(this.countdown);
    this.countdown = null;
    this.lobby = cancelLobbyCountdown(this.lobby);
    return active;
  }

  private checkReady() {
    const next = scheduleLobbyCountdown(this.lobby, this.lobbyParticipants(), this.runtime.now(), this.countdownMs);
    if (next === this.lobby) return;
    this.lobby = next;
    this.scheduleCountdown(next.generation, this.countdownMs);
  }

  private scheduleCountdown(generation: number, delayMs: number) {
    const timer = this.runtime.schedule(() => {
      if (this.countdown !== timer) return;
      const resolution = resolveLobbyCountdown(this.lobby, this.lobbyParticipants(), generation, this.runtime.now());
      if (resolution.status === 'stale') return;
      if (resolution.status === 'early') {
        this.countdown = null;
        this.scheduleCountdown(generation, resolution.remainingMs);
        return;
      }
      this.countdown = null;
      this.lobby = resolution.state;
      if (resolution.status === 'started' && !this.game && this.initializeGame()) {
        const firstId = resolution.state.startedPlayers?.[0]?.id;
        if (firstId && this.game) this.game = setFirstTurn(this.game, firstId);
      }
      this.publish();
    }, Math.max(1, delayMs));
    this.countdown = timer;
  }

  commandLobby(playerId: string, peer: LobbyPeer, message: LobbyCommand) {
    const participant = this.participants.find(item => item.id === playerId && item.peer === peer);
    if (!participant) return;
    if (message.type === 'clock') {
      peer.send({ type: 'clock', sentAt: message.sentAt, serverNow: this.runtime.now() });
      return;
    }
    const updated = updateLobbyReady(this.participants, playerId, message.ready, this.started);
    if (!updated) return;
    this.participants = updated;
    if (!message.ready) this.cancelCountdown();
    else this.checkReady();
    this.publish();
  }

  exitLobby(playerId: string, peer: LobbyPeer) {
    const participant = this.participants.find(item => item.id === playerId && item.peer === peer);
    if (!participant) return;
    participant.exited = true;
    participant.peer = null;
    this.participants = this.participants.filter(item => item !== participant);
    this.lastOccupiedAt = this.runtime.now();
    if (!this.cancelCountdown()) this.checkReady();
    this.publish();
  }

  exitDice(playerId: string, peer: DicePeer) {
    const participant = this.participants.find(item => item.id === playerId && item.peer === peer);
    if (!participant) return;
    participant.exited = true;
    participant.peer = null;
    this.participants = this.participants.filter(item => item !== participant);
    this.lastOccupiedAt = this.runtime.now();
    this.publish();
  }

  disconnect(playerId: string, peer: RoomPeer) {
    const participant = this.participants.find(item => item.id === playerId && item.peer === peer);
    if (!participant) return;
    participant.peer = null;
    participant.leftAt = this.runtime.now();
    this.lastOccupiedAt = participant.leftAt;
    if (!this.started && !this.cancelCountdown()) this.checkReady();
    this.publish();
  }

  prune(now: number) {
    if (this.participants.every(participant => !participant.peer)) return roomGraceExpired(this.lastOccupiedAt, now, ROOM_SESSION_GRACE_MS);
    const remaining = this.participants.filter(participant => participant.peer || !reconnectGraceExpired(participant.leftAt, now, ROOM_SESSION_GRACE_MS));
    if (remaining.length === this.participants.length) return false;
    this.participants = remaining;
    if (this.mode === 'preview' && this.game) this.game = selectTurnAfterPrune(this.game, this.dicePlayers());
    this.publish();
    return false;
  }

  commandDice(playerId: string, peer: DicePeer, message: DiceCommand) {
    const participant = this.participants.find(item => item.id === playerId && item.peer === peer);
    if (!participant || !this.game || !this.boardDefinition) return;
    if (message.type === 'confirm') {
      if (this.rollView?.id !== message.rollId || !this.rollView.results.length) return;
      participant.viewedRoll = message.rollId;
      if (this.rollView.confirmed) return;
      const next = confirmRoll(this.game, participant.id, message.rollId, this.rollView.results);
      if (!next) return;
      this.game = next;
      this.rollView = { ...this.rollView, confirmed: true };
      this.publish();
      return;
    }

    if (!hasTurn(this.game, participant.id)) {
      this.sendDiceError(peer, 'TURN', '手番プレイヤーが操作できます。');
      return;
    }

    switch (message.type) {
      case 'config':
        if (!canConfigure(this.game, participant.dev)) {
          this.sendDiceError(peer, 'CONFIG', '開発設定はロールの開始前に変更できます。');
          return;
        }
        this.game = setRollConfig(this.game, message.config);
        this.publish();
        return;
      case 'roll':
      case 'reroll': {
        const kind = message.type === 'roll' ? 'initial' : 'reroll';
        const decision = createDiceRollRequest(this.game, participant.id, kind, message.requestId, participant.seenRequests, participant.dev);
        if (decision.status === 'duplicate') return;
        if (decision.status === 'turn') {
          this.sendDiceError(peer, 'TURN', '手番プレイヤーが操作できます。');
          return;
        }
        if (decision.status === 'phase') {
          this.sendDiceError(peer, 'PHASE', '現在の状態では振れません。');
          return;
        }
        if (decision.status === 'place-first') {
          this.sendDiceError(peer, 'PLACE_FIRST', 'このロールで1個以上配置すると、残りを振り直せます。');
          return;
        }
        participant.seenRequests = decision.seen;
        this.startRoll(kind);
        return;
      }
      case 'place': {
        const result = placeDie(this.game, this.boardDefinition, message);
        if (result.status === 'ignored') return;
        if (result.status === 'invalid') {
          this.sendDiceError(peer, 'CELL', '行の左端の空きマスに、指定と同じ宝石のダイスを置けます。');
          return;
        }
        this.game = result.state;
        this.publish();
        return;
      }
      case 'end-turn': {
        const status = endTurnStatus(this.game, this.boardDefinition, message.revision);
        if (status === 'ignored') return;
        if (status === 'place-first') {
          this.sendDiceError(peer, 'PLACE_FIRST', '置けるダイスがあるときは1個以上配置してください。');
          return;
        }
        this.game = finishTurn(this.game, this.dicePlayers(), participant.id);
        this.publish();
        return;
      }
    }
  }

  private startRoll(kind: RollKind) {
    if (!this.game) return;
    const previous = kind === 'reroll' ? this.rollView?.latest.dice.filter(die => this.game?.remaining.includes(die.id)) ?? [] : [];
    const rollId = this.runtime.createPlayerId();
    const started = beginRoll(this.game, rollId, kind, this.game.config.count, previous);
    const ids = started.diceIds;
    if (!ids.length) return;
    const config = { count: ids.length, hz: this.game!.config.hz };
    const session = this.runtime.createRoll({ rollId, kind, ids, config }, {
      frame: frame => this.captureRoll(rollId, frame),
      metrics: metrics => this.broadcastMetrics(metrics),
      finished: (frame, results, nudges, deadline) => this.finishRoll(rollId, frame, results, nudges, deadline),
    });
    this.game = started.state;
    this.rollSession = session;
    this.rollView = {
      id: rollId, kind, config, previous, latest: session.initialFrame,
      results: [], confirmed: false, nudges: 0, deadline: false,
    };
    this.publish();
    session.start();
  }

  private captureRoll(rollId: string, frame: Frame) {
    if (this.rollView?.id !== rollId) return false;
    this.rollView = { ...this.rollView, latest: frame };
    return this.broadcastFrame(frame);
  }

  private finishRoll(rollId: string, frame: Frame, results: readonly DiceResult[], nudges: number, deadline: boolean) {
    if (this.rollView?.id !== rollId || !this.game) return;
    this.rollView = { ...this.rollView, latest: frame, results, nudges, deadline };
    this.game = finishRoll(this.game, rollId);
    this.rollSession = null;
    this.publish();
  }

  private broadcastFrame(frame: Frame) {
    let sent = false;
    for (const participant of this.participants) {
      if (participant.peer?.protocol === 'dice' && participant.peer.send({ type: 'frame', frame }, true)) sent = true;
    }
    return sent;
  }

  private broadcastMetrics(metrics: import('../../../shared/contracts/dice').Metrics) {
    for (const participant of this.participants) {
      if (participant.dev && participant.peer?.protocol === 'dice') participant.peer.send({ type: 'metrics', metrics }, true);
    }
  }

  private sendDiceError(peer: DicePeer, code: string, message: string) {
    peer.send({ type: 'error', code, message });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelCountdown();
    this.rollSession?.stop();
    this.rollSession = null;
    for (const participant of this.participants) participant.peer?.close(1001, 'room disposed');
    this.participants = [];
  }
}
