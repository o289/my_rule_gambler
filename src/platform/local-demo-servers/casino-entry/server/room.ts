import { randomBytes, randomUUID } from 'node:crypto';
import { COUNTDOWN_MS, MAX_PLAYERS } from '../../../../shared/contracts/casino-entry';
import type { CasinoRoomInfo, ClientMessage, LobbyState, Seat, ServerMessage } from '../../../../shared/contracts/casino-entry';
import {
  cancelLobbyCountdown,
  createLobbyState,
  initialLobbyCountdownState,
  resolveLobbyCountdown,
  scheduleLobbyCountdown,
  updateLobbyReady,
} from '../../../server/core/lobby';
import type { LobbyCountdownState } from '../../../server/core/lobby';
import { availableSeatSlot, reconnectGraceExpired, roomGraceExpired } from '../../../server/core/participant-lifecycle';

export const SESSION_GRACE_MS = 90_000;

export interface RoomPeer {
  send(message: ServerMessage): void;
  close(): void;
}

interface Member extends Omit<Seat, 'online'> {
  token: string;
  peer: RoomPeer | null;
  leftAt: number | null;
}

type Command = Extract<ClientMessage, { type: 'ready' | 'clock' }>;

export class CasinoRoom {
  private members: Member[] = [];
  private lastOccupiedAt = Date.now();
  private countdown: ReturnType<typeof setTimeout> | null = null;
  private countdownState: LobbyCountdownState = initialLobbyCountdownState();

  constructor(readonly info: CasinoRoomInfo, private readonly countdownMs = COUNTDOWN_MS) {}

  get empty() { return this.members.length === 0; }

  private participants() {
    return this.members.map(({ id, name, slot, ready, peer }) => ({ id, name, slot, ready, online: peer !== null }));
  }

  private cancelCountdown() {
    const active = this.countdownState.startAt !== null;
    if (this.countdown) clearTimeout(this.countdown);
    this.countdown = null;
    this.countdownState = cancelLobbyCountdown(this.countdownState);
    return active;
  }

  private checkReady() {
    const next = scheduleLobbyCountdown(this.countdownState, this.participants(), Date.now(), this.countdownMs);
    if (next === this.countdownState) return;
    this.countdownState = next;
    this.scheduleCountdownTimer(next.generation, this.countdownMs);
  }

  private scheduleCountdownTimer(generation: number, delay: number) {
    const countdown = setTimeout(() => {
      if (this.countdown !== countdown) return;
      const resolution = resolveLobbyCountdown(this.countdownState, this.participants(), generation, Date.now());
      if (resolution.status === 'early') {
        this.countdown = null;
        this.scheduleCountdownTimer(generation, resolution.remainingMs);
        return;
      }
      if (resolution.status === 'stale') return;
      this.countdown = null;
      this.countdownState = resolution.state;
      this.update();
    }, Math.max(1, delay));
    this.countdown = countdown;
  }

  private state(): LobbyState {
    return createLobbyState(this.participants(), this.countdownState, Date.now());
  }

  private update() {
    const state = this.state();
    for (const member of this.members) member.peer?.send({ type: 'state', state });
  }

  join(peer: RoomPeer, token?: string) {
    let member = token ? this.members.find(item => item.token === token) : undefined;
    if (token && !member) {
      peer.send({ type: 'error', code: 'TOKEN', message: '再接続の期間が終了しました。ルームを選んでください。' });
      return null;
    }
    if (!member) {
      if (this.countdownState.startedPlayers !== null) {
        peer.send({ type: 'error', code: 'STARTED', message: 'このルームはすでにゲームを開始しています。' });
        return null;
      }
      if (this.members.length >= MAX_PLAYERS) {
        peer.send({ type: 'error', code: 'FULL', message: 'このルームの定員は6名です。' });
        return null;
      }
      const slot = availableSeatSlot(this.members, MAX_PLAYERS);
      if (slot === null) return null;
      member = { id: randomUUID(), name: `PLAYER ${slot + 1}`, slot, ready: false, token: randomBytes(24).toString('base64url'), peer: null, leftAt: null };
      this.members.push(member);
    }
    const prior = member.peer;
    member.peer = peer;
    prior?.close();
    member.leftAt = null;
    this.lastOccupiedAt = Date.now();

    if (!prior && !this.cancelCountdown()) this.checkReady();

    peer.send({ type: 'welcome', playerId: member.id, token: member.token, room: this.info, state: this.state() });
    this.update();
    return member.id;
  }

  leave(playerId: string, peer: RoomPeer) {
    const member = this.members.find(item => item.id === playerId && item.peer === peer);
    if (!member) return;
    member.peer = null;
    member.leftAt = Date.now();
    this.lastOccupiedAt = member.leftAt;
    if (!this.cancelCountdown()) this.checkReady();
    this.update();
  }

  exit(playerId: string, peer: RoomPeer) {
    const member = this.members.find(item => item.id === playerId && item.peer === peer);
    if (!member) return;
    this.members = this.members.filter(item => item !== member);
    if (!this.cancelCountdown()) this.checkReady();
    this.lastOccupiedAt = Date.now();
    this.update();
  }

  prune(now: number) {
    if (this.members.every(member => !member.peer)) return roomGraceExpired(this.lastOccupiedAt, now, SESSION_GRACE_MS);
    const remaining = this.members.filter(member => member.peer || !reconnectGraceExpired(member.leftAt, now, SESSION_GRACE_MS));
    if (remaining.length !== this.members.length) {
      this.members = remaining;
      this.update();
    }
    return false;
  }

  command(playerId: string, peer: RoomPeer, message: Command) {
    const member = this.members.find(item => item.id === playerId && item.peer === peer);
    if (!member) return;

    if (message.type === 'clock') {
      peer.send({ type: 'clock', sentAt: message.sentAt, serverNow: Date.now() });
      return;
    }

    const members = updateLobbyReady(this.members, playerId, message.ready, this.countdownState.startedPlayers !== null);
    if (!members) return;
    this.members = members;
    if (!message.ready) this.cancelCountdown();
    else this.checkReady();
    this.update();
  }

  dispose() {
    this.cancelCountdown();
    for (const member of this.members) member.peer?.close();
    this.members = [];
  }
}
