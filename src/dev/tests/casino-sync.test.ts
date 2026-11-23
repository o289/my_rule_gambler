import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startCasinoServer } from '../../platform/local-demo-servers/casino-entry/server/http';
import { COUNTDOWN_MS, MAX_PLAYERS, parseJson, readServerMessage } from '../../shared/contracts/casino-entry';
import type { ClientMessage, ServerMessage } from '../../shared/contracts/casino-entry';

class Client {
  readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.socket.on('message', raw => {
      const message = readServerMessage(parseJson(raw.toString()));
      assert.ok(message, 'server message matches the common protocol');
      this.received.push(message);
    });
  }

  send(message: ClientMessage) { this.socket.send(JSON.stringify(message)); }

  async wait<T extends ServerMessage['type']>(type: T, check?: (event: Extract<ServerMessage, { type: T }>) => boolean, since = 0) {
    const deadline = performance.now() + 10_000;
    const typed = (event: ServerMessage): event is Extract<ServerMessage, { type: T }> => event.type === type;
    while (performance.now() < deadline) {
      const message = this.received.slice(since).filter(typed).find(event => check?.(event) ?? true);
      if (message) return message;
      await delay(12);
    }
    throw new Error(`WebSocket timeout waiting for ${type}`);
  }

  async start(message: ClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
    this.send(message);
  }

  async create(name: string) { await this.start({ type: 'create', name }); return this.wait('welcome'); }
  async join(room: string, token?: string) { await this.start({ type: 'join', room, token }); return this.wait('welcome'); }

  async close() {
    const closing = once(this.socket, 'close');
    this.socket.close();
    await closing;
  }
}

test('the independent casino server starts two clients from the same deadline and restores their lobby', { timeout: 18_000 }, async () => {
  const server = await startCasinoServer({ port: 0 });
  try {
    const host = new Client(server.port);
    const guest = new Client(server.port);
    const first = await host.create('夜のサロン');
    const room = first.room.id;
    const second = await guest.join(room.toUpperCase());
    assert.match(room, /^[a-f\d]{8}$/);
    assert.deepEqual(first.room, { id: room, name: '夜のサロン' });
    assert.deepEqual(second.room, first.room);
    assert.equal(first.state.phase, 'waiting');
    assert.equal(second.state.hostId, first.playerId);
    assert.deepEqual(second.state.seats.map(seat => seat.slot), [0, 1]);
    assert.notEqual(first.token, second.token);

    const sentAt = Date.now();
    host.send({ type: 'clock', sentAt });
    const clock = await host.wait('clock');
    assert.equal(clock.sentAt, sentAt);
    assert.ok(clock.serverNow >= sentAt);

    host.socket.send(JSON.stringify({ type: 'roll', requestId: 'unexpected-dice-command' }));
    await host.wait('error', event => event.code === 'INPUT');

    host.send({ type: 'ready', ready: true });
    const halfReady = await guest.wait('state', event => event.state.seats[0]?.ready === true);
    assert.equal(halfReady.state.phase, 'waiting');
    guest.send({ type: 'ready', ready: true });
    const [countdownHost, countdownGuest] = await Promise.all([
      host.wait('state', event => event.state.phase === 'countdown'),
      guest.wait('state', event => event.state.phase === 'countdown'),
    ]);
    assert.equal(countdownHost.state.startAt, countdownGuest.state.startAt);
    assert.ok((countdownHost.state.startAt ?? 0) - countdownHost.state.serverTime >= COUNTDOWN_MS - 500);
    let next = host.received.length;

    guest.send({ type: 'ready', ready: false });
    await host.wait('state', event => event.state.phase === 'waiting' && event.state.seats[1]?.ready === false, next);
    guest.send({ type: 'ready', ready: true });
    const restarted = await host.wait('state', event => event.state.phase === 'countdown', next);
    next = host.received.length;

    const newcomer = new Client(server.port);
    const added = await newcomer.join(room);
    assert.equal(added.state.phase, 'waiting');
    assert.equal(added.state.seats.length, 3);
    await host.wait('state', event => event.state.phase === 'waiting' && event.state.seats.length === 3, next);
    newcomer.send({ type: 'ready', ready: true });
    await host.wait('state', event => event.state.phase === 'countdown', next);
    next = host.received.length;
    newcomer.send({ type: 'leave' });
    await host.wait('state', event => event.state.phase === 'waiting' && event.state.seats.length === 2, next);
    await guest.close();
    await host.wait('state', event => event.state.seats[1]?.online === false, next);

    const resumed = new Client(server.port);
    const welcome = await resumed.join(room, second.token);
    assert.equal(welcome.playerId, second.playerId);
    assert.equal(welcome.state.seats[1]?.ready, true);
    assert.equal(welcome.state.phase, 'countdown');
    assert.ok((welcome.state.startAt ?? 0) >= (restarted.state.startAt ?? 0));

    const [startedHost, startedGuest] = await Promise.all([
      host.wait('state', event => event.state.phase === 'started'),
      resumed.wait('state', event => event.state.phase === 'started'),
    ]);
    assert.deepEqual(startedHost.state, startedGuest.state);
    assert.equal(startedHost.state.startAt, null);
    assert.equal(host.received.filter(event => event.type === 'state' && event.state.phase === 'started').length, 1);
    const denied = new Client(server.port);
    await denied.start({ type: 'join', room });
    await denied.wait('error', event => event.code === 'STARTED');
    await resumed.close();
    const returned = new Client(server.port);
    const finished = await returned.join(room, second.token);
    assert.equal(finished.playerId, second.playerId);
    assert.equal(finished.state.phase, 'started');
    assert.deepEqual(finished.room, first.room);
    assert.deepEqual(finished.state.startedPlayers?.map(seat => seat.id), startedHost.state.startedPlayers?.map(seat => seat.id));
  } finally { server.close(); }
});

test('only creation allocates a room and denied joins leave its seat list intact', { timeout: 5_000 }, async () => {
  const server = await startCasinoServer({ port: 0 });
  try {
    const invalid = new Client(server.port);
    await invalid.start({ type: 'join', room: 'ROOM?' });
    await invalid.wait('error', event => event.code === 'INPUT');
    const missing = new Client(server.port);
    await missing.start({ type: 'join', room: 'not-a-room' });
    await missing.wait('error', event => event.code === 'NOT_FOUND');
    const first = new Client(server.port);
    const second = new Client(server.port);
    const { room } = await first.create('同じ名前');
    const other = await second.create('同じ名前');
    assert.notEqual(other.room.id, room.id);
    assert.equal(other.state.seats.length, 1);

    for (let seat = 1; seat < MAX_PLAYERS; seat += 1) {
      const guest = new Client(server.port);
      const welcome = await guest.join(room.id);
      assert.equal(welcome.state.seats.length, seat + 1);
      assert.deepEqual(welcome.room, room);
    }
    const denied = new Client(server.port);
    await denied.start({ type: 'join', room: room.id });
    await denied.wait('error', event => event.code === 'FULL');
    assert.equal(denied.received.some(event => event.type === 'welcome'), false);
    const full = await first.wait('state', event => event.state.seats.length === MAX_PLAYERS);
    assert.ok(full.state.seats.every(seat => seat.online));

    const leaving = new Client(server.port);
    const made = await leaving.create('退出する卓');
    const closed = once(leaving.socket, 'close');
    leaving.send({ type: 'leave' });
    await closed;
    const afterExit = new Client(server.port);
    await afterExit.start({ type: 'join', room: made.room.id });
    await afterExit.wait('error', event => event.code === 'NOT_FOUND');
  } finally { server.close(); }
});
