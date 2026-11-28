import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Room } from '../../platform/server/core/room';
import type { LobbyPeer } from '../../platform/server/core/room';
import type { RoomRuntime } from '../../platform/server/core/ports';
import { MAX_PLAYERS, MIN_PLAYERS, readClientMessage, readServerMessage } from '../../shared/contracts/casino-entry';
import type { ServerMessage } from '../../shared/contracts/casino-entry';
import { DEFAULT_GAME_RULES } from '../../shared/contracts/game-rules';

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

test('2〜6人全員の準備が揃うと、共通の開始時刻と重複しない固定の席で開始する', async () => {
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

test('1人では開始できず、参加状況の変更で開始を取り消し、再接続しても参加者の識別子を保つ', async () => {
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

test('待機中に準備前の参加者が退出し、残りが条件を満たすと自動で開始する', async () => {
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

test('準備状態のメッセージは真偽値だけを受け付ける', () => {
  assert.deepEqual(readClientMessage({ type: 'ready', ready: false }), { type: 'ready', ready: false, rulesRevision: 0 });
  assert.equal(readClientMessage({ type: 'ready', ready: true, rulesRevision: 1.5 }), null);
  assert.equal(readClientMessage({ type: 'ready', ready: 1 }), null);
  assert.equal(readClientMessage({ type: 'ready' }), null);
  assert.equal(readClientMessage({ type: 'set-rules', rules: { victoryPoints: 301, startingDice: 10 }, rulesRevision: 0 }), null);
  assert.equal(readClientMessage({ type: 'set-rules', rules: { victoryPoints: 700, startingDice: 7 }, rulesRevision: 0 }), null);
  assert.deepEqual(readClientMessage({ type: 'set-rules', rules: { victoryPoints: 700, startingDice: 10 }, rulesRevision: 0 }),
    { type: 'set-rules', rules: { victoryPoints: 700, startingDice: 10 }, rulesRevision: 0 });
  assert.equal(readClientMessage({ type: 'clock', sentAt: -1 }), null);
});

test('ルール変更はホストだけが待機中に行え、全READY解除後は古いREADY世代を拒む', () => {
  const room = new Room(roomInfo, runtime, { mode: 'standard', countdownMs });
  try {
    const host = join(room);
    const guest = join(room);
    assert.deepEqual(host.state.rules, DEFAULT_GAME_RULES);
    ready(room, host);
    room.commandLobby(guest.welcome.playerId, guest, {
      type: 'set-rules', rules: { victoryPoints: 700, startingDice: 8 }, rulesRevision: 0,
    });
    assert.ok(guest.seen.some(message => message.type === 'error' && message.code === 'RULES_LOCKED'));
    assert.equal(host.state.rulesRevision, 0);

    room.commandLobby(host.welcome.playerId, host, {
      type: 'set-rules', rules: { victoryPoints: 700, startingDice: 8 }, rulesRevision: 0,
    });
    assert.equal(host.state.rules.victoryPoints, 700);
    assert.equal(host.state.rules.startingDice, 8);
    assert.equal(host.state.rulesRevision, 1);
    assert.ok(host.state.seats.every(seat => !seat.ready));
    room.commandLobby(guest.welcome.playerId, guest, { type: 'ready', ready: true, rulesRevision: 0 });
    assert.ok(guest.seen.some(message => message.type === 'error' && message.code === 'STALE_RULES'));
    assert.equal(host.state.phase, 'waiting');

    room.commandLobby(host.welcome.playerId, host, { type: 'ready', ready: true, rulesRevision: 1 });
    room.commandLobby(guest.welcome.playerId, guest, { type: 'ready', ready: true, rulesRevision: 1 });
    assert.equal(host.state.phase, 'countdown');
    room.commandLobby(host.welcome.playerId, host, {
      type: 'set-rules', rules: { victoryPoints: 300, startingDice: 'official' }, rulesRevision: 1,
    });
    assert.ok(host.seen.some(message => message.type === 'error' && message.code === 'RULES_LOCKED'));
    assert.equal(host.state.rules.victoryPoints, 700, 'countdown locks the current rules');
  } finally { room.dispose(); }
});

test('保存済みルールは復元され、ルール項目のない旧形式は既定値で復元する', () => {
  const room = new Room(roomInfo, runtime, { mode: 'standard', countdownMs });
  const host = join(room);
  join(room);
  room.commandLobby(host.welcome.playerId, host, {
    type: 'set-rules', rules: { victoryPoints: 1200, startingDice: 12 }, rulesRevision: 0,
  });
  const saved = room.snapshot();
  room.dispose();

  const restored = Room.restore(roomInfo, runtime, saved);
  assert.ok(restored);
  try {
    const reconnected = join(restored, host.welcome.token);
    assert.deepEqual(reconnected.state.rules, { victoryPoints: 1200, startingDice: 12 });
    assert.equal(reconnected.state.rulesRevision, 1);
  } finally { restored.dispose(); }

  const { rules: _rules, rulesRevision: _rulesRevision, totalDice: _totalDice, ...legacy } = saved;
  const legacyRestored = Room.restore(roomInfo, runtime, legacy);
  assert.ok(legacyRestored);
  try {
    const reconnected = join(legacyRestored, host.welcome.token);
    assert.deepEqual(reconnected.state.rules, DEFAULT_GAME_RULES);
    assert.equal(reconnected.state.rulesRevision, 0);
  } finally { legacyRestored.dispose(); }
});

test('部屋に入るメッセージは名前付きの部屋作成とIDによる検索を区別する', () => {
  assert.deepEqual(readClientMessage({ type: 'create' }), { type: 'create' });
  assert.equal(readClientMessage({ type: 'create', name: null }), null);
  assert.deepEqual(readClientMessage({ type: 'create', name: '  夜のサロン  ' }), { type: 'create', name: '夜のサロン' });
  assert.equal(readClientMessage({ type: 'create', name: ' ' }), null);
  assert.equal(readClientMessage({ type: 'create', name: 'table\u0007' }), null);
  assert.equal(readClientMessage({ type: 'create', name: '卓'.repeat(33) }), null);
  assert.deepEqual(readClientMessage({ type: 'join', room: ' AB12CF34 ' }), { type: 'join', room: 'ab12cf34', token: undefined });
  assert.equal(readClientMessage({ type: 'join', room: 'サロン?' }), null);
  assert.equal(readClientMessage({ type: 'join', room: '' }), null);
});
