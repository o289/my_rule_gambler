import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createGoalBoard } from '../../features/board/model/goal-layout';
import { nextOpenCell, requiredGemAt } from '../../features/board/model/board-model';
import { startDiceServer } from '../../platform/local-demo-servers/dice/server/http';
import { parseJson, readServerMessage } from '../../shared/contracts/dice';
import type { ClientMessage, ServerMessage } from '../../shared/contracts/dice';

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

  async join(token?: string, dev = true) {
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
    this.send({ type: 'join', room: 'test-table', token, dev });
    return this.wait('welcome');
  }

  async close() {
    const closing = once(this.socket, 'close');
    this.socket.close();
    await closing;
  }
}

test('サーバーは1つの物理演算を共有して途中から再開し、出目確定と振り直しを各1回だけ受け付ける', { timeout: 22_000 }, async () => {
  const server = await startDiceServer({ port: 0, allowDev: true });
  try {
    const owner = new Client(server.port);
    const other = new Client(server.port);
    const first = await owner.join();
    const second = await other.join();
    assert.equal(first.state.turnId, first.playerId);
    assert.notEqual(first.token, second.token);
    assert.equal(first.state.config.hz, 120);
    const seed = first.state.boardSeed;
    assert.ok(seed !== undefined);
    assert.equal(second.state.boardSeed, seed);
    const definition = createGoalBoard(seed);

    other.send({ type: 'roll', requestId: 'non-owner' });
    await other.wait('error', event => event.code === 'TURN');
    owner.send({ type: 'config', config: { count: 4, hz: 240 } });
    await other.wait('state', event => event.state.config.hz === 240);

    owner.send({ type: 'roll', requestId: 'duplicate-start' });
    owner.send({ type: 'roll', requestId: 'duplicate-start' });
    const started = await owner.wait('state', event => event.state.phase === 'rolling');
    assert.ok(started.roll);
    const rollId = started.roll.id;
    assert.equal(started.roll.config.count, 4);
    owner.send({ type: 'config', config: { count: 1, hz: 120 } });
    await owner.wait('error', message => message.code === 'CONFIG');

    const leavingAt = await other.wait('frame', message => message.frame.rollId === rollId && message.frame.dice.length >= 1);
    await other.close();
    const resumed = new Client(server.port);
    const welcome = await resumed.join(second.token);
    assert.equal(welcome.playerId, second.playerId);
    assert.equal(welcome.state.boardSeed, seed);
    assert.ok(welcome.view);
    assert.equal(welcome.roll?.id, rollId);
    assert.ok((welcome.roll?.latest.seq ?? -1) >= leavingAt.frame.seq);

    const finished = await owner.wait('state', event => event.roll?.id === rollId && event.state.phase === 'confirm');
    const mirrored = await resumed.wait('state', event => event.roll?.id === rollId && event.state.phase === 'confirm');
    assert.equal(finished.roll?.results.length, 4);
    assert.deepEqual(finished.roll?.latest.dice, mirrored.roll?.latest.dice);
    assert.deepEqual(finished.roll?.results, mirrored.roll?.results);
    assert.equal(new Set(owner.received.flatMap(event => event.type === 'frame' ? [event.frame.rollId] : [])).size, 1);
    const frames = owner.received.flatMap(event => event.type === 'frame' ? [event.frame] : []);
    const sameFrames = resumed.received.flatMap(event => event.type === 'frame' ? [event.frame] : []);
    assert.ok(sameFrames.length >= 20);
    const source = new Map(frames.map(frame => [frame.seq, frame]));
    for (const frame of sameFrames) assert.deepEqual(frame, source.get(frame.seq));
    const performanceReport = await owner.wait('metrics', event => event.metrics.stepsPerSecond !== null);
    assert.ok((performanceReport.metrics.stepsPerSecond ?? 0) > 200);
    assert.ok((performanceReport.metrics.sentPerSecond ?? 0) > 47);
    assert.ok((performanceReport.metrics.meanStepMs ?? -1) >= 0);
    assert.ok((performanceReport.metrics.cpuPercent ?? -1) >= 0);

    const unconfirmed = new Client(server.port);
    const observer = await unconfirmed.join(undefined, false);
    assert.equal(observer.dev, false);
    assert.ok(observer.view);

    const beforeConfirm = owner.received.length;
    resumed.send({ type: 'confirm', rollId });
    await delay(85);
    assert.equal(owner.received.slice(beforeConfirm).some(event => event.type === 'state' && event.state.phase === 'placement'), false);
    owner.send({ type: 'confirm', rollId });
    owner.send({ type: 'confirm', rollId });
    const shared = await resumed.wait('state', event => event.state.phase === 'placement');
    assert.equal(shared.state.revision, started.state.revision + 1);
    assert.ok(shared.roll?.confirmed);
    assert.equal(shared.state.remaining.length, 4);
    await unconfirmed.close();
    const observerAgain = new Client(server.port);
    const progressed = await observerAgain.join(observer.token, false);
    assert.equal(progressed.state.revision, shared.state.revision);
    assert.equal(progressed.state.boardSeed, seed);
    assert.deepEqual(progressed.state.results, shared.state.results);
    assert.equal(progressed.view, false);

    const available = definition.rows.flatMap((row, rowIndex) => {
      const cell = nextOpenCell(definition, new Set<string>(), row.id);
      if (!cell) return [];
      const die = shared.state.results.find(item => item.gem === requiredGemAt(definition, cell));
      return die ? [{ die, rowIndex }] : [];
    });
    const legal = available[0];
    assert.ok(legal, 'every kind of gem opens at least one row');

    owner.send({ type: 'place', rollId, dieId: legal.die.id, row: legal.rowIndex, column: 1 });
    await owner.wait('error', event => event.code === 'CELL');
    owner.send({ type: 'place', rollId, dieId: legal.die.id, row: legal.rowIndex, column: 0 });
    const placed = await resumed.wait('state', event => event.state.placedThisRoll);
    assert.deepEqual(placed.state.placements, [{ row: legal.rowIndex, column: 0, gem: legal.die.gem }]);
    assert.equal(placed.state.boardSeed, seed);
    const remaining = placed.state.remaining;
    owner.send({ type: 'config', config: { count: 1, hz: 120 } });
    const configured = await resumed.wait('state', event => event.state.phase === 'placement' && event.state.config.count === 1);
    assert.equal(configured.roll?.config.hz, 240);
    owner.send({ type: 'reroll', requestId: 'reroll' });
    const rerolled = await resumed.wait('state', event => event.roll?.kind === 'reroll');
    assert.notEqual(rerolled.roll?.id, rollId);
    assert.equal(rerolled.roll?.config.hz, 120);
    assert.equal(rerolled.roll?.config.count, remaining.length);
    assert.deepEqual(rerolled.roll?.previous.map(die => die.id), remaining);
  } finally { server.close(); }
});


test('新しいダイス部屋では接続が1人でもダイスを振れる', async () => {
  const server = await startDiceServer({ port: 0, allowDev: false });
  try {
    const player = new Client(server.port);
    const welcome = await player.join(undefined, false);
    assert.equal(welcome.state.seats.length, 1);
    assert.equal(welcome.state.turnId, welcome.playerId);
    assert.equal(welcome.state.phase, 'ready');
    player.send({ type: 'roll', requestId: 'solo-roll' });
    const rolling = await player.wait('state', message => message.state.phase === 'rolling');
    assert.ok(rolling.roll);
  } finally { server.close(); }
});
