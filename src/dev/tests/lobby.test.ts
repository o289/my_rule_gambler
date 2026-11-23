import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Room } from '../../platform/server/core/room';
import type { LobbyPeer } from '../../platform/server/core/room';
import type { RoomRuntime } from '../../platform/server/core/ports';
import { MAX_PLAYERS, MIN_PLAYERS, readClientMessage, readServerMessage } from '../../shared/contracts/casino-entry';
import type { ServerMessage } from '../../shared/contracts/casino-entry';

class Guest implements LobbyPeer {
  readonly protocol = 'lobby' as const;
  readonly seen: ServerMessage[] = [];
  close() {}
  send(message: ServerMessage) {
    assert.ok(readServerMessage(message));
    this.seen.push(message);
    return true;
  }

  get state() {
    const latest = [...this.seen].reverse().find(message => message.type === 'state' || message.type === 'welcome');
    assert.ok(latest?.type === 'state' || latest?.type === 'welcome');
    return latest.state;
  }

  get welcome() {
    const welcome = this.seen.find(message => message.type === 'welcome');
    assert.ok(welcome);
    return welcome;
  }
}

const countdownMs = 45;
let nextId = 0;
const runtime: RoomRuntime = {
  now: () => Date.now(), createPlayerId: () => `player-${++nextId}`, createToken: () => String(++nextId).padStart(32, 't'),
  createBoardSeed: () => 1, schedule: (callback, delay) => setTimeout(callback, delay),
  cancelTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  createRoll: () => { throw new Error('Dice roll is not used in lobby tests'); }, allowPreviewDev: false,
};
const roomInfo = { id: 'test', name: 'テスト卓' };

function join(room: Room, token?: string) {
  const guest = new Guest();
  room.connectLobby(guest, token);
  return guest;
}

function ready(room: Room, guest: Guest, value = true) {
  room.commandLobby(guest.welcome.playerId, guest, { type: 'ready', ready: value });
}

test('only all-ready groups of two to six start, with a shared deadline and unique stable slots', async () => {
  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count += 1) {
    const room = new Room(roomInfo, runtime, { mode: 'standard', countdownMs });
    try {
      const guests = Array.from({ length: count }, () => join(room));
      const host = guests[0];
      const last = guests.at(-1);
      assert.ok(host && last);
      guests.slice(0, -1).forEach(guest => ready(room, guest));
      assert.equal(host.state.phase, 'waiting');
      ready(room, last);
      assert.equal(host.state.phase, 'countdown');
      const startAt = host.state.startAt;
      ready(room, last);
      for (const guest of guests) {
        assert.equal(guest.state.startAt, startAt);
        assert.equal(guest.state.hostId, host.welcome.playerId);
        assert.deepEqual(guest.state.seats.map(seat => seat.slot), guests.map((_, index) => index));
        assert.ok(guest.state.seats.every(seat => seat.ready && seat.online));
      }
      if (count === MAX_PLAYERS) {
        const denied = join(room);
        assert.ok(denied.seen.some(message => message.type === 'error' && message.code === 'FULL'));
        assert.equal(host.state.startAt, startAt);
      }
      await delay(countdownMs + 20);
      for (const guest of guests) {
        assert.equal(guest.state.phase, 'started');
        assert.equal(guest.state.startAt, null);
        assert.deepEqual(guest.state.startedPlayers?.map(seat => seat.id), guests.map(item => item.welcome.playerId));
        assert.equal(guest.seen.filter(message => message.type === 'state' && message.state.phase === 'started').length, 1);
      }
      ready(room, last, false);
      assert.equal(last.state.phase, 'started');
      const fixedStartOrder = last.state.startedPlayers;
      const lateJoiner = join(room);
      assert.ok(lateJoiner.seen.some(message => message.type === 'error' && message.code === 'STARTED'));
      room.exitLobby(guests[0]!.welcome.playerId, guests[0]!);
      assert.deepEqual(last.state.startedPlayers, fixedStartOrder, 'later exits do not change the frozen start order');
    } finally { room.dispose(); }
  }
});

test('starting is blocked alone and cancelled by participation changes, with stable reconnect identity', async () => {
  const room = new Room(roomInfo, runtime, { mode: 'standard', countdownMs });
  try {
    const a = join(room);
    ready(room, a);
    assert.equal(a.state.phase, 'waiting');
    const b = join(room);
    ready(room, b);
    assert.equal(a.state.phase, 'countdown');

    const c = join(room);
    assert.equal(a.state.phase, 'waiting');
    await delay(countdownMs + 15);
    assert.equal(a.state.phase, 'waiting');
    ready(room, c);
    assert.equal(a.state.phase, 'countdown');
    room.exitLobby(c.welcome.playerId, c);
    assert.equal(a.state.phase, 'waiting');
    assert.equal(a.state.seats.length, 2);
    ready(room, a);
    await delay(countdownMs + 15);
    assert.equal(a.state.phase, 'waiting', 'duplicate READY cannot restart a cancelled countdown');
    ready(room, a, false);
    ready(room, a);
    assert.equal(a.state.phase, 'countdown');

    room.disconnect(b.welcome.playerId, b);
    assert.equal(a.state.phase, 'waiting');
    assert.equal(a.state.seats[1]?.online, false);
    await delay(countdownMs + 15);
    const restored = join(room, b.welcome.token);
    assert.equal(restored.welcome.playerId, b.welcome.playerId);
    assert.equal(restored.state.seats[1]?.slot, 1);
    assert.equal(restored.state.seats[1]?.ready, true);
    assert.equal(restored.state.phase, 'countdown');
    const replacement = join(room, b.welcome.token);
    assert.equal(replacement.state.startAt, restored.state.startAt);
    room.disconnect(restored.welcome.playerId, restored);
    assert.equal(a.state.phase, 'countdown', 'obsolete socket close cannot cancel');
    await delay(countdownMs + 15);
    assert.equal(a.state.phase, 'started');
    const startedReturn = join(room, b.welcome.token);
    assert.equal(startedReturn.state.phase, 'started');
    assert.deepEqual(startedReturn.state.startedPlayers, a.state.startedPlayers);
    room.exitLobby(a.welcome.playerId, a);
    assert.equal(startedReturn.state.hostId, startedReturn.welcome.playerId);
  } finally { room.dispose(); }
});

test('an unready departure while waiting automatically starts an eligible group', async () => {
  const room = new Room(roomInfo, runtime, { mode: 'standard', countdownMs });
  try {
    const first = join(room);
    const second = join(room);
    const waiting = join(room);
    ready(room, first);
    ready(room, second);
    assert.equal(first.state.phase, 'waiting');
    room.exitLobby(waiting.welcome.playerId, waiting);
    assert.equal(first.state.phase, 'countdown');
    await delay(countdownMs + 15);
    assert.equal(second.state.phase, 'started');
  } finally { room.dispose(); }
});

test('READY packets accept explicit booleans only', () => {
  assert.deepEqual(readClientMessage({ type: 'ready', ready: false }), { type: 'ready', ready: false });
  assert.equal(readClientMessage({ type: 'ready', ready: 1 }), null);
  assert.equal(readClientMessage({ type: 'ready' }), null);
  assert.equal(readClientMessage({ type: 'clock', sentAt: -1 }), null);
});

test('room entry packets distinguish creating a named room from looking up an ID', () => {
  assert.deepEqual(readClientMessage({ type: 'create', name: '  夜のサロン  ' }), { type: 'create', name: '夜のサロン' });
  assert.equal(readClientMessage({ type: 'create', name: ' ' }), null);
  assert.equal(readClientMessage({ type: 'create', name: 'table\u0007' }), null);
  assert.equal(readClientMessage({ type: 'create', name: '卓'.repeat(33) }), null);
  assert.deepEqual(readClientMessage({ type: 'join', room: ' AB12CF34 ' }), { type: 'join', room: 'ab12cf34', token: undefined });
  assert.equal(readClientMessage({ type: 'join', room: 'サロン?' }), null);
  assert.equal(readClientMessage({ type: 'join', room: '' }), null);
});
