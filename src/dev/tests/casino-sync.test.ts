import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startCasinoServer } from '../../platform/local-demo-servers/casino-entry/server/http';
import { COUNTDOWN_MS, parseJson, readServerMessage } from '../../shared/contracts/casino-entry';
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

  async join(token?: string) {
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
    this.send({ type: 'join', room: 'test-salon', token });
    return this.wait('welcome');
  }

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
    const first = await host.join();
    const second = await guest.join();
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
    const added = await newcomer.join();
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
    const welcome = await resumed.join(second.token);
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
    await resumed.close();
    const returned = new Client(server.port);
    const finished = await returned.join(second.token);
    assert.equal(finished.playerId, second.playerId);
    assert.equal(finished.state.phase, 'started');
    assert.deepEqual(finished.state.startedPlayers?.map(seat => seat.id), startedHost.state.startedPlayers?.map(seat => seat.id));
  } finally { server.close(); }
});
