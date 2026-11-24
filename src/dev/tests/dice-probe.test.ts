import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { parseRoomId, parseRoomName, readServerMessage as readLobbyServerMessage } from '../../shared/contracts/casino-entry';
import type { ServerMessage as LobbyServerMessage } from '../../shared/contracts/casino-entry';
import { readServerMessage as readDiceServerMessage } from '../../shared/contracts/dice';
import type { ServerMessage as DiceServerMessage } from '../../shared/contracts/dice';
import { createGoalBoard } from '../../features/board/model/goal-layout';
import { nextOpenCell, requiredGemAt } from '../../features/board/model/board-model';

process.env.WRANGLER_LOG_PATH ??= '/tmp/gambler-wrangler-test.log';
process.env.WRANGLER_SEND_METRICS ??= 'false';
const require = createRequire(import.meta.url);
const unstableDev = require('wrangler').unstable_dev as (
  script: string,
  options: {
    config: string; env: string; ip: string; port: number; local: boolean;
    inspect: boolean; persist: boolean; logLevel: 'error';
  },
) => Promise<{ port: number; stop(): Promise<void> }>;

interface ProbeEvent {
  readonly type: string;
  readonly rollId?: string;
  readonly frame?: {
    readonly rollId: string;
    readonly phase: string;
    readonly seq: number;
    readonly dice: readonly { readonly id: string; readonly p: readonly number[]; readonly stopped: boolean }[];
  };
  readonly results?: readonly { readonly id: string; readonly gem: string }[];
  readonly metrics?: { readonly elapsedMs: number; readonly steps: number; readonly frames: number };
}

class ProbeClient {
  readonly socket: WebSocket;
  readonly events: ProbeEvent[] = [];

  constructor(endpoint: string, room: string) {
    const url = new URL(endpoint);
    url.searchParams.set('room', room);
    this.socket = new WebSocket(url);
    this.socket.on('message', data => this.events.push(JSON.parse(data.toString()) as ProbeEvent));
  }

  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          once(this.socket, 'open'),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out opening probe socket')), 10_000); }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  send(rollId: string, kind: 'initial' | 'reroll', ids: readonly string[]) {
    this.socket.send(JSON.stringify({ type: 'roll', rollId, kind, ids }));
  }

  async waitFor(type: string, rollId: string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const event = this.events.find(item => item.type === type && item.rollId === rollId);
      if (event) return event;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type} (${rollId})`);
  }

  async close() {
    this.socket.terminate();
  }
}

class LobbyClient {
  readonly socket: WebSocket;
  readonly messages: LobbyServerMessage[] = [];

  constructor(endpoint: string, room: string) {
    const url = new URL(endpoint);
    url.searchParams.set('room', room);
    this.socket = new WebSocket(url);
    this.socket.on('message', data => {
      const message = readLobbyServerMessage(JSON.parse(data.toString()));
      if (message) this.messages.push(message);
    });
  }

  async open() { await once(this.socket, 'open'); }
  send(value: unknown) { this.socket.send(JSON.stringify(value)); }
  private async waitUntil(predicate: (message: LobbyServerMessage) => boolean, from = 0) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = this.messages.slice(from).find(predicate);
      if (message) return message;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for lobby message');
  }
  waitFor(type: LobbyServerMessage['type']) { return this.waitUntil(item => item.type === type); }
  async waitForPhase(phase: 'waiting' | 'countdown' | 'started', from = 0) {
    const message = await this.waitUntil(item => item.type === 'state' && item.state.phase === phase, from);
    if (message.type !== 'state') throw new Error(`Expected lobby phase ${phase}`);
    return message;
  }
  close() { this.socket.terminate(); }
}

class DiceRoomClient {
  readonly socket: WebSocket;
  readonly messages: DiceServerMessage[] = [];

  constructor(endpoint: string, room: string) {
    const url = new URL(endpoint);
    url.searchParams.set('room', room);
    this.socket = new WebSocket(url);
    this.socket.on('message', data => {
      const message = readDiceServerMessage(JSON.parse(data.toString()));
      if (message) this.messages.push(message);
    });
  }
  async open() { await once(this.socket, 'open'); }
  send(value: unknown) { this.socket.send(JSON.stringify(value)); }
  async waitForWelcome() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = this.messages.find(item => item.type === 'welcome');
      if (message?.type === 'welcome') return message;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for dice welcome');
  }
  async waitForStatePhase(phase: 'ready' | 'rolling' | 'confirm' | 'placement' | 'finished', from = 0) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const message = this.messages.slice(from).find(item => item.type === 'state' && item.state.phase === phase);
      if (message?.type === 'state') return message;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for dice phase ${phase}`);
  }
  async waitForError(code?: string, from = 0) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = this.messages.slice(from).find(item => item.type === 'error' && (code === undefined || item.code === code));
      if (message?.type === 'error') return message;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for dice error');
  }
  close() { this.socket.terminate(); }
}

function firstLegalPlacement(seed: number, results: readonly { id: string; gem: string }[]) {
  const board = createGoalBoard(seed);
  for (const [rowIndex, row] of board.rows.entries()) {
    const cell = nextOpenCell(board, new Set<string>(), row.id);
    if (!cell) continue;
    const gem = requiredGemAt(board, cell);
    const die = results.find(result => result.gem === gem);
    if (!die) continue;
    const column = board.columns.findIndex(item => item.id === cell.columnId);
    if (column >= 0) return { dieId: die.id, row: rowIndex, column };
  }
  throw new Error('No legal first placement found for the confirmed roll');
}

function eventsForRoll(client: ProbeClient, rollId: string) {
  return client.events.filter(event => (event.rollId ?? event.frame?.rollId) === rollId);
}

function assertReceivedResult(event: ProbeEvent, expectedIds: readonly string[]) {
  assert.equal(event.results?.length, expectedIds.length);
  assert.deepEqual(event.results?.map(result => result.id).sort(), [...expectedIds].sort());
  const metrics = event.metrics;
  assert.ok(metrics?.steps && metrics.steps > 0);
  assert.ok(metrics?.frames && metrics.frames > 1);
}

function assertMotionFrames(frames: readonly ProbeEvent[]) {
  const rollingFrames = frames.flatMap(event => event.frame?.phase === 'rolling' ? [event.frame] : []);
  assert.ok(rollingFrames.length > 1, 'the roll includes intermediate motion frames');
  const dieId = rollingFrames[0]!.dice[0]?.id;
  assert.ok(dieId, 'rolling frames include a die');
  const positions = rollingFrames.flatMap(frame => {
    const die = frame.dice.find(item => item.id === dieId);
    return die ? [die.p] : [];
  });
  assert.ok(positions.length > 1 && positions.some(position => JSON.stringify(position) !== JSON.stringify(positions[0])), 'the same die changes position during the roll');
  const last = frames.at(-1)?.frame;
  assert.equal(last?.phase, 'settled');
  assert.ok(last?.dice.length && last.dice.every(die => die.stopped), 'the final frame shows every die stopped');
}

async function verifyRoomAdmission(endpoint: string, pageUrl: URL) {
  const apiUrl = new URL('/api/rooms', pageUrl);
  const foreignOrigin = await fetch(apiUrl, {
    method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'should not exist' }),
  });
  assert.equal(foreignOrigin.status, 403);

  const create = async (name: string) => {
    const response = await fetch(apiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    assert.equal(response.status, 201);
    const value: unknown = await response.json();
    assert.ok(typeof value === 'object' && value !== null && 'id' in value && 'name' in value);
    assert.equal(typeof value.id, 'string');
    assert.equal(typeof value.name, 'string');
    if (typeof value.id !== 'string' || typeof value.name !== 'string') throw new Error('Room response fields are invalid');
    assert.match(value.id, /^[a-f0-9]{8}$/);
    assert.equal(parseRoomId(value.id), value.id);
    assert.equal(parseRoomName(value.name), value.name);
    assert.deepEqual(Object.keys(value).sort(), ['id', 'name']);
    return { id: value.id, name: value.name };
  };

  const roomA = await create(`stg-${randomUUID().slice(0, 8)}-a`);
  const roomB = await create(`stg-${randomUUID().slice(0, 8)}-b`);
  assert.notEqual(roomA.id, roomB.id);
  for (const path of ['/casino-ws', '/dice-ws']) {
    const unknown = new URL(path, pageUrl);
    unknown.searchParams.set('room', 'deadbeef');
    assert.equal((await fetch(unknown)).status, 404);
    assert.equal((await fetch(unknown)).status, 404);
    const existing = new URL(path, pageUrl);
    existing.searchParams.set('room', roomA.id);
    assert.equal((await fetch(existing)).status, 426);
  }

  const lobbyBase = new URL(endpoint);
  lobbyBase.pathname = '/casino-ws';
  const playerA = new LobbyClient(lobbyBase.toString(), roomA.id);
  const playerB = new LobbyClient(lobbyBase.toString(), roomB.id);
  let dice: WebSocket | null = null;
  let replacement: LobbyClient | null = null;
  let gameRoomPlayerA: LobbyClient | null = null;
  let gameRoomPlayerB: LobbyClient | null = null;
  let gameDiceA: DiceRoomClient | null = null;
  let gameDiceB: DiceRoomClient | null = null;
  try {
    await Promise.all([playerA.open(), playerB.open()]);
    playerA.send({ type: 'join', room: roomA.id });
    playerB.send({ type: 'join', room: roomB.id });
    const [welcomeAValue, welcomeBValue] = await Promise.all([playerA.waitFor('welcome'), playerB.waitFor('welcome')]);
    if (welcomeAValue.type !== 'welcome' || welcomeBValue.type !== 'welcome') throw new Error('Expected room welcome messages');
    assert.equal(welcomeAValue.room.id, roomA.id);
    assert.equal(welcomeAValue.room.name, roomA.name);
    assert.equal(welcomeBValue.room.id, roomB.id);
    assert.equal(welcomeBValue.room.name, roomB.name);
    assert.equal(welcomeAValue.state.seats.length, 1);
    assert.equal(welcomeBValue.state.seats.length, 1);
    assert.match(welcomeAValue.token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(new URL(playerA.socket.url).searchParams.has('token'), false);

    const diceUrl = new URL(endpoint);
    diceUrl.pathname = '/dice-ws';
    diceUrl.searchParams.set('room', roomA.id);
    dice = new WebSocket(diceUrl);
    await once(dice, 'open');
    const notStarted = new Promise<LobbyServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for NOT_STARTED')), 10_000);
      dice?.once('message', data => {
        clearTimeout(timeout);
        const message = readLobbyServerMessage(JSON.parse(data.toString()));
        if (message) resolve(message);
        else reject(new Error('Unexpected dice connection response'));
      });
    });
    dice.send(JSON.stringify({ type: 'join', room: roomA.id, token: welcomeAValue.token }));
    const diceMessage = await notStarted;
    assert.equal(diceMessage.type, 'error');
    if (diceMessage.type === 'error') assert.equal(diceMessage.code, 'NOT_STARTED');
    dice.terminate();
    dice = null;

    playerA.send({ type: 'leave' });
    await once(playerA.socket, 'close');
    replacement = new LobbyClient(lobbyBase.toString(), roomA.id);
    await replacement.open();
    replacement.send({ type: 'join', room: roomA.id });
    const replacementValue = await replacement.waitFor('welcome');
    if (replacementValue.type !== 'welcome') throw new Error('Expected replacement welcome');
    assert.equal(replacementValue.state.seats.length, 1);

    const gameRoom = await create(`stg-${randomUUID().slice(0, 8)}-ready`);
    gameRoomPlayerA = new LobbyClient(lobbyBase.toString(), gameRoom.id);
    gameRoomPlayerB = new LobbyClient(lobbyBase.toString(), gameRoom.id);
    await Promise.all([gameRoomPlayerA.open(), gameRoomPlayerB.open()]);
    gameRoomPlayerA.send({ type: 'join', room: gameRoom.id });
    gameRoomPlayerB.send({ type: 'join', room: gameRoom.id });
    const [gameWelcomeA, gameWelcomeB] = await Promise.all([
      gameRoomPlayerA.waitFor('welcome'), gameRoomPlayerB.waitFor('welcome'),
    ]);
    if (gameWelcomeA.type !== 'welcome' || gameWelcomeB.type !== 'welcome') throw new Error('Expected game room welcomes');
    gameRoomPlayerA.send({ type: 'ready', ready: true });
    gameRoomPlayerB.send({ type: 'ready', ready: true });
    const countdown = await gameRoomPlayerA.waitForPhase('countdown');
    assert.ok(countdown.state.startAt !== null);
    const countdownB = await gameRoomPlayerB.waitForPhase('countdown');
    assert.equal(countdownB.state.startAt, countdown.state.startAt, 'both players share the countdown deadline');
    const beforeCancelA = gameRoomPlayerA.messages.length;
    const beforeCancelB = gameRoomPlayerB.messages.length;
    gameRoomPlayerA.send({ type: 'ready', ready: false });
    const cancelled = await gameRoomPlayerA.waitForPhase('waiting', beforeCancelA);
    const cancelledB = await gameRoomPlayerB.waitForPhase('waiting', beforeCancelB);
    assert.equal(cancelled.state.startAt, null, 'cancelling READY returns the shared room to waiting');
    assert.equal(cancelledB.state.startAt, null);
    const beforeRestartA = gameRoomPlayerA.messages.length;
    const beforeRestartB = gameRoomPlayerB.messages.length;
    gameRoomPlayerA.send({ type: 'ready', ready: true });
    gameRoomPlayerB.send({ type: 'ready', ready: true });
    const startedMessages = await Promise.all([
      gameRoomPlayerA.waitForPhase('started', beforeRestartA), gameRoomPlayerB.waitForPhase('started', beforeRestartB),
    ]);
    const fixedPlayers = startedMessages[0]!.state.startedPlayers;
    assert.ok(fixedPlayers && fixedPlayers.length === 2);
    assert.deepEqual(startedMessages[1]!.state.startedPlayers, fixedPlayers);
    assert.deepEqual(startedMessages[1]!.state, startedMessages[0]!.state, 'the start snapshot is identical for both players');
    for (const client of [gameRoomPlayerA, gameRoomPlayerB]) {
      assert.equal(client.messages.filter(item => item.type === 'state' && item.state.phase === 'started').length, 1,
        'the room publishes one start transition per participant');
    }

    const diceBase = new URL(endpoint);
    diceBase.pathname = '/dice-ws';
    gameDiceA = new DiceRoomClient(diceBase.toString(), gameRoom.id);
    gameDiceB = new DiceRoomClient(diceBase.toString(), gameRoom.id);
    await Promise.all([gameDiceA.open(), gameDiceB.open()]);
    gameDiceA.send({ type: 'join', room: gameRoom.id, token: gameWelcomeA.token });
    gameDiceB.send({ type: 'join', room: gameRoom.id, token: gameWelcomeB.token });
    const [diceWelcomeA, diceWelcomeB] = await Promise.all([gameDiceA.waitForWelcome(), gameDiceB.waitForWelcome()]);
    assert.equal(diceWelcomeA.playerId, gameWelcomeA.playerId);
    assert.equal(diceWelcomeB.playerId, gameWelcomeB.playerId);
    assert.equal(diceWelcomeA.match?.roundNumber, 1);
    assert.deepEqual(diceWelcomeA.match, diceWelcomeB.match);
    assert.deepEqual(diceWelcomeA.state.seats.map(seat => seat.id), fixedPlayers.map(seat => seat.id));
    assert.equal(diceWelcomeA.state.turnId, fixedPlayers[0]!.id);
    assert.equal(typeof diceWelcomeA.state.boardSeed, 'number');
    assert.deepEqual(diceWelcomeA.state, diceWelcomeB.state);
    const activeId = diceWelcomeA.state.turnId;
    const activeDice = diceWelcomeA.playerId === activeId ? gameDiceA : gameDiceB;
    const otherDice = activeDice === gameDiceA ? gameDiceB : gameDiceA;
    otherDice.send({ type: 'roll', requestId: `out-of-turn-${randomUUID()}`, turnSequence: diceWelcomeA.state.turnSequence });
    assert.equal((await otherDice.waitForError('TURN')).code, 'TURN', 'non-turn participants cannot start a roll');

    const beforeRollA = gameDiceA.messages.length;
    const beforeRollB = gameDiceB.messages.length;
    activeDice.send({ type: 'roll', requestId: `room-roll-${randomUUID()}`, turnSequence: diceWelcomeA.state.turnSequence });
    const [confirmA, confirmB] = await Promise.all([
      gameDiceA.waitForStatePhase('confirm', beforeRollA), gameDiceB.waitForStatePhase('confirm', beforeRollB),
    ]);
    assert.deepEqual(confirmA.state, confirmB.state);
    assert.equal(confirmA.roll?.latest.phase, 'settled');
    assert.equal(confirmA.roll?.results.length, 5);
    assert.deepEqual(confirmA.roll?.results, confirmB.roll?.results);
    const diceResults = confirmA.roll?.results ?? [];
    const rollFramesA = gameDiceA.messages.flatMap(message => message.type === 'frame' && message.frame.rollId === confirmA.roll?.id ? [message] : []);
    const rollFramesB = gameDiceB.messages.flatMap(message => message.type === 'frame' && message.frame.rollId === confirmA.roll?.id ? [message] : []);
    const rollingFrames = rollFramesA.filter(message => message.frame.phase === 'rolling');
    assert.ok(rollingFrames.length > 1);
    const movingDieId = rollingFrames[0]?.type === 'frame' ? rollingFrames[0].frame.dice[0]?.id : undefined;
    assert.ok(movingDieId);
    const firstPosition = rollingFrames[0]?.type === 'frame'
      ? rollingFrames[0].frame.dice.find(die => die.id === movingDieId)?.p : undefined;
    assert.ok(rollingFrames.some(message => message.frame.dice.some(die => die.id === movingDieId
      && JSON.stringify(die.p) !== JSON.stringify(firstPosition))));
    assert.equal(rollFramesA.at(-1)?.type, 'frame');
    if (rollFramesA.at(-1)?.type === 'frame') assert.equal(rollFramesA.at(-1)!.frame.phase, 'settled');
    assert.deepEqual(rollFramesA, rollFramesB, 'both dice sockets receive the same frames');
    const confirmedRollId = confirmA.roll?.id;
    if (!confirmedRollId || typeof diceWelcomeA.state.boardSeed !== 'number') throw new Error('Missing roll or board seed');
    const beforeConfirmA = gameDiceA.messages.length;
    const beforeConfirmB = gameDiceB.messages.length;
    activeDice.send({ type: 'confirm', rollId: confirmedRollId });
    const [placementA, placementB] = await Promise.all([
      gameDiceA.waitForStatePhase('placement', beforeConfirmA), gameDiceB.waitForStatePhase('placement', beforeConfirmB),
    ]);
    assert.deepEqual(placementA.state, placementB.state);
    const target = firstLegalPlacement(diceWelcomeA.state.boardSeed, diceResults);
    const beforeStale = activeDice.messages.length;
    activeDice.send({
      type: 'place', rollId: confirmedRollId, dieId: target.dieId, row: target.row,
      column: target.column, revision: placementA.state.revision - 1,
    });
    activeDice.send({ type: 'config', config: { count: 5, hz: 120 } });
    assert.equal((await activeDice.waitForError('CONFIG', beforeStale)).code, 'CONFIG', 'the later command confirms the socket processed the stale placement first');
    assert.equal(gameDiceA.messages.some(message => message.type === 'state' && message.state.revision > placementA.state.revision), false,
      'a stale revision cannot place or publish');
    const beforePlaceA = gameDiceA.messages.length;
    const beforePlaceB = gameDiceB.messages.length;
    activeDice.send({
      type: 'place', rollId: confirmedRollId, dieId: target.dieId, row: target.row,
      column: target.column, revision: placementA.state.revision,
    });
    const [placedA, placedB] = await Promise.all([
      gameDiceA.waitForStatePhase('placement', beforePlaceA),
      gameDiceB.waitForStatePhase('placement', beforePlaceB),
    ]);
    assert.equal(placedA.state.revision, placementA.state.revision + 1);
    assert.deepEqual(placedA.state, placedB.state);
    assert.deepEqual(placedA.match, placedB.match);
    assert.equal(placedA.state.placements.length, 1);
    assert.equal(placedA.state.placements[0]?.dieId, target.dieId);
    assert.equal(placedA.match?.players.find(player => player.id === activeId)?.diceCount, 14);
  } finally {
    playerA.close();
    playerB.close();
    replacement?.close();
    gameRoomPlayerA?.close();
    gameRoomPlayerB?.close();
    gameDiceA?.close();
    gameDiceB?.close();
    dice?.terminate();
  }
}

test('STG dice probe streams matching physics frames and results to two clients in separate rooms', { timeout: 45_000 }, async () => {
  const stgEndpoint = process.env.STG_DICE_PROBE_URL?.trim() || undefined;
  if (stgEndpoint) {
    const url = new URL(stgEndpoint);
    assert.equal(url.protocol, 'wss:', 'STG_DICE_PROBE_URL must use secure WebSockets');
    assert.equal(url.username, '', 'Do not put credentials in the URL');
    assert.equal(url.password, '', 'Do not put credentials in the URL');
    assert.equal(url.pathname, '/dice-probe');
    assert.equal(url.search, '', 'The test supplies a unique room name');
    assert.equal(url.hash, '');
  }
  const worker = stgEndpoint ? undefined : await unstableDev('src/platform/cloudflare/dice-probe/worker.ts', {
    config: 'wrangler.jsonc', env: 'stg', ip: '127.0.0.1', port: 0,
    local: true, inspect: false, persist: false, logLevel: 'error',
  });
  const endpoint = stgEndpoint ?? `ws://127.0.0.1:${worker!.port}/dice-probe`;
  const runId = `probe-${randomUUID().replaceAll('-', '')}`;
  const roomA = `${runId}-a`;
  const roomB = `${runId}-b`;
  const aInitial = `a-initial-${runId}`;
  const bInitial = `b-initial-${runId}`;
  const aReroll = `a-reroll-${runId}`;
  const bSecond = `b-second-${runId}`;
  const clients = [
    new ProbeClient(endpoint, roomA), new ProbeClient(endpoint, roomA),
    new ProbeClient(endpoint, roomB), new ProbeClient(endpoint, roomB),
  ];
  try {
    const pageUrl = new URL(endpoint);
    pageUrl.protocol = pageUrl.protocol === 'wss:' ? 'https:' : 'http:';
    pageUrl.pathname = '/';
    pageUrl.search = '';
    const navigationHeaders = { headers: { 'Sec-Fetch-Mode': 'navigate' } };
    const page = await fetch(pageUrl, navigationHeaders);
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /id="root"/);
    const scriptPath = pageHtml.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(scriptPath, 'the page references a built JavaScript asset');
    const scriptUrl = new URL(scriptPath, pageUrl);
    assert.equal((await fetch(scriptUrl)).status, 200);
    for (const preview of ['list', 'result', 'effects']) {
      const previewUrl = new URL(pageUrl);
      previewUrl.searchParams.set('preview', preview);
      assert.equal((await fetch(previewUrl, navigationHeaders)).status, 404);
    }
    const spaUrl = new URL('/game/stg-route', pageUrl);
    assert.equal((await fetch(spaUrl, navigationHeaders)).status, 200);
    assert.equal((await fetch(new URL('/casino-ws', pageUrl))).status, 404);
    assert.equal((await fetch(new URL('/dice-ws', pageUrl))).status, 404);
    if (worker) {
      const assets = readdirSync('dist-stg/assets');
      assert.equal(assets.some(name => /(?:Board|Effects|Players|Bank|Result)Preview/.test(name)), false,
        'STG build omits standalone preview chunks');
      await verifyRoomAdmission(endpoint, pageUrl);
    }
    await Promise.all(clients.map(client => client.open()));
    const baselineStarted = performance.now();
    clients[0]!.send(aInitial, 'initial', ['a1', 'a2', 'a3', 'a4', 'a5']);
    const baseline = await Promise.all([
      clients[0]!.waitFor('finished', aInitial), clients[1]!.waitFor('finished', aInitial),
    ]);
    const baselineClientMs = Math.round(performance.now() - baselineStarted);
    const baselineFrames = eventsForRoll(clients[0]!, aInitial).filter(event => event.type === 'frame');
    assert.deepEqual(baselineFrames, eventsForRoll(clients[1]!, aInitial).filter(event => event.type === 'frame'));
    assertMotionFrames(baselineFrames);
    assert.deepEqual(baseline[0]!.results, baseline[1]!.results);
    assertReceivedResult(baseline[0]!, ['a1', 'a2', 'a3', 'a4', 'a5']);
    assert.equal(eventsForRoll(clients[2]!, aInitial).length, 0);
    assert.equal(eventsForRoll(clients[3]!, aInitial).length, 0);

    const firstWaveStarted = performance.now();
    clients[0]!.send(aReroll, 'reroll', ['a1', 'a2', 'a3', 'a4', 'a5']);
    clients[2]!.send(bInitial, 'initial', ['b1', 'b2', 'b3', 'b4', 'b5']);
    const firstWave = await Promise.all([
      clients[0]!.waitFor('finished', aReroll), clients[1]!.waitFor('finished', aReroll),
      clients[2]!.waitFor('finished', bInitial), clients[3]!.waitFor('finished', bInitial),
    ]);
    const firstWaveClientMs = Math.round(performance.now() - firstWaveStarted);

    for (const [left, right, rollId] of [[clients[0]!, clients[1]!, aReroll], [clients[2]!, clients[3]!, bInitial]] as const) {
      const leftFrames = eventsForRoll(left, rollId).filter(event => event.type === 'frame');
      const rightFrames = eventsForRoll(right, rollId).filter(event => event.type === 'frame');
      assert.deepEqual(leftFrames, rightFrames);
      assertMotionFrames(leftFrames);
    }
    assert.deepEqual(firstWave[0]!.results, firstWave[1]!.results);
    assert.deepEqual(firstWave[2]!.results, firstWave[3]!.results);
    assertReceivedResult(firstWave[0]!, ['a1', 'a2', 'a3', 'a4', 'a5']);
    assertReceivedResult(firstWave[2]!, ['b1', 'b2', 'b3', 'b4', 'b5']);
    assert.ok(firstWave[0]!.metrics?.elapsedMs && firstWave[0]!.metrics!.elapsedMs > 0);
    assert.equal(eventsForRoll(clients[1]!, bInitial).length, 0);
    assert.equal(eventsForRoll(clients[3]!, aReroll).length, 0);

    const secondWaveStarted = performance.now();
    const aSecondReroll = `a-reroll-2-${runId}`;
    clients[0]!.send(aSecondReroll, 'reroll', ['a1', 'a2', 'a3', 'a4', 'a5']);
    clients[2]!.send(bSecond, 'reroll', ['b1', 'b2', 'b3', 'b4', 'b5']);
    const secondWave = await Promise.all([
      clients[0]!.waitFor('finished', aSecondReroll), clients[1]!.waitFor('finished', aSecondReroll),
      clients[2]!.waitFor('finished', bSecond), clients[3]!.waitFor('finished', bSecond),
    ]);
    const secondWaveClientMs = Math.round(performance.now() - secondWaveStarted);
    assert.deepEqual(secondWave[0]!.results, secondWave[1]!.results);
    assert.deepEqual(secondWave[2]!.results, secondWave[3]!.results);
    assertReceivedResult(secondWave[0]!, ['a1', 'a2', 'a3', 'a4', 'a5']);
    assertReceivedResult(secondWave[2]!, ['b1', 'b2', 'b3', 'b4', 'b5']);
    for (const [left, right, rollId] of [[clients[0]!, clients[1]!, aSecondReroll], [clients[2]!, clients[3]!, bSecond]] as const) {
      const leftFrames = eventsForRoll(left, rollId).filter(event => event.type === 'frame');
      const rightFrames = eventsForRoll(right, rollId).filter(event => event.type === 'frame');
      assert.deepEqual(leftFrames, rightFrames);
      assertMotionFrames(leftFrames);
    }
    assert.equal(eventsForRoll(clients[1]!, bSecond).length, 0);
    assert.equal(eventsForRoll(clients[3]!, aSecondReroll).length, 0);
    if (stgEndpoint) {
      console.log(JSON.stringify({
        stgProbe: true,
        rooms: 2,
        clientsPerRoom: 2,
        concurrentRolls: [
          { kind: 'initial', metrics: baseline[0]!.metrics },
          { kind: 'reroll', metrics: firstWave[0]!.metrics },
          { kind: 'initial', metrics: firstWave[2]!.metrics },
          { kind: 'reroll', metrics: secondWave[0]!.metrics },
          { kind: 'reroll', metrics: secondWave[2]!.metrics },
        ],
        clientMs: { baseline: baselineClientMs, firstWave: firstWaveClientMs, secondWave: secondWaveClientMs },
      }));
    }
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await worker?.stop();
  }
});
