import { randomBytes, randomUUID } from 'node:crypto';
import { COUNTDOWN_MS, MAX_PLAYERS, MIN_PLAYERS } from '../../../../shared/contracts/casino-entry';
import type { ClientMessage, LobbyState, Seat, ServerMessage } from '../../../../shared/contracts/casino-entry';

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
  private startAt: number | null = null;
  private started = false;
  private startedPlayers: Seat[] | null = null;

  constructor(private readonly countdownMs = COUNTDOWN_MS) {}

  get empty() { return this.members.length === 0; }

  private eligible() {
    const online = this.members.filter(member => member.peer);
    return online.length >= MIN_PLAYERS && online.every(member => member.ready);
  }

  private cancelCountdown() {
    if (!this.countdown) return false;
    clearTimeout(this.countdown);
    this.countdown = null;
    this.startAt = null;
    return true;
  }

  private checkReady() {
    if (this.started || this.countdown || !this.eligible()) return;
    this.startAt = Date.now() + this.countdownMs;
    const countdown = setTimeout(() => {
      if (this.countdown !== countdown) return;
      this.cancelCountdown();
      this.started = this.eligible();
      if (this.started) {
        this.startedPlayers = this.members
          .filter(member => member.peer !== null)
          .sort((a, b) => a.slot - b.slot)
          .map(member => ({ id: member.id, name: member.name, slot: member.slot, ready: member.ready, online: true }));
      }
      this.update();
    }, this.countdownMs);
    this.countdown = countdown;
  }

  private state(): LobbyState {
    return {
      seats: this.members.map(({ id, name, slot, ready, peer }) => ({ id, name, slot, ready, online: peer !== null })),
      startedPlayers: this.startedPlayers?.map(seat => ({ ...seat })) ?? null,
      phase: this.started ? 'started' : this.countdown ? 'countdown' : 'waiting',
      hostId: this.members.find(member => member.peer)?.id ?? null,
      startAt: this.startAt,
      serverTime: Date.now(),
    };
  }

  private update() {
    const state = this.state();
    for (const member of this.members) member.peer?.send({ type: 'state', state });
  }

  join(peer: RoomPeer, { token }: Extract<ClientMessage, { type: 'join' }>) {
    let member = token ? this.members.find(item => item.token === token) : undefined;
    if (token && !member) {
      peer.send({ type: 'error', code: 'TOKEN', message: '再接続の期間が終了しました。新しいプレイヤーとして参加します。' });
      return null;
    }
    if (!member) {
      if (this.members.length >= MAX_PLAYERS) {
        peer.send({ type: 'error', code: 'FULL', message: 'このルームの定員は6名です。' });
        return null;
      }
      const slot = Array.from({ length: MAX_PLAYERS }, (_, index) => index).find(index => !this.members.some(item => item.slot === index));
      if (slot === undefined) return null;
      member = { id: randomUUID(), name: `PLAYER ${slot + 1}`, slot, ready: false, token: randomBytes(24).toString('base64url'), peer: null, leftAt: null };
      this.members.push(member);
    }
    const prior = member.peer;
    member.peer = peer;
    prior?.close();
    member.leftAt = null;
    this.lastOccupiedAt = Date.now();

    if (!prior && !this.cancelCountdown()) this.checkReady();

    peer.send({ type: 'welcome', playerId: member.id, token: member.token, state: this.state() });
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
    if (this.members.every(member => !member.peer)) return now - this.lastOccupiedAt >= SESSION_GRACE_MS;
    const remaining = this.members.filter(member => member.peer || member.leftAt === null || now - member.leftAt < SESSION_GRACE_MS);
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

    if (this.started || member.ready === message.ready) return;
    member.ready = message.ready;
    if (!member.ready) this.cancelCountdown();
    else this.checkReady();
    this.update();
  }

  dispose() {
    this.cancelCountdown();
    for (const member of this.members) member.peer?.close();
    this.members = [];
  }
}
