import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startLocalDemoServers } from '../../platform/local-demo-servers/start';
import { parseJson as parseLobby, readServerMessage as readLobby } from '../../shared/contracts/casino-entry';
import type { ClientMessage as LobbyClientMessage, ServerMessage as LobbyServerMessage } from '../../shared/contracts/casino-entry';
import { parseJson as parseDice, readServerMessage as readDice } from '../../shared/contracts/dice';
import type { ClientMessage as DiceClientMessage, ServerMessage as DiceServerMessage } from '../../shared/contracts/dice';

class LobbyClient {
  readonly socket: WebSocket;
  readonly messages: LobbyServerMessage[] = [];
  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.socket.on('message', data => {
      const message = readLobby(parseLobby(data.toString()));
      assert.ok(message);
      this.messages.push(message);
    });
  }
  async send(message: LobbyClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
    this.socket.send(JSON.stringify(message));
  }
  async wait<T extends LobbyServerMessage['type']>(type: T, check?: (message: Extract<LobbyServerMessage, { type: T }>) => boolean) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const found = this.messages.find((message): message is Extract<LobbyServerMessage, { type: T }> => message.type === type && (check?.(message as Extract<LobbyServerMessage, { type: T }>) ?? true));
      if (found) return found;
      await delay(8);
    }
    throw new Error(`Timed out waiting for lobby ${type}`);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closing = once(this.socket, 'close');
    this.socket.close();
    await closing;
  }
}

class DiceClient {
  readonly socket: WebSocket;
  readonly messages: DiceServerMessage[] = [];
  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.socket.on('message', data => {
      const message = readDice(parseDice(data.toString()));
      assert.ok(message);
      this.messages.push(message);
    });
  }
  async send(message: DiceClientMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
    this.socket.send(JSON.stringify(message));
  }
  async wait<T extends DiceServerMessage['type']>(type: T, check?: (message: Extract<DiceServerMessage, { type: T }>) => boolean) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const found = this.messages.find((message): message is Extract<DiceServerMessage, { type: T }> => message.type === type && (check?.(message as Extract<DiceServerMessage, { type: T }>) ?? true));
      if (found) return found;
      await delay(8);
    }
    throw new Error(`Timed out waiting for dice ${type}`);
  }
}

test('通常起動ではカジノとダイスの接続を同じ部屋につなぎ、未知の対戦IDを拒む', { timeout: 12_000 }, async () => {
  const servers = await startLocalDemoServers({ dicePort: 0, casinoPort: 0, allowDev: true, countdownMs: 35 });
  const sockets: WebSocket[] = [];
  try {
    const host = new LobbyClient(servers.casinoPort);
    const guest = new LobbyClient(servers.casinoPort);
    const absent = new LobbyClient(servers.casinoPort);
    sockets.push(host.socket, guest.socket, absent.socket);
    await host.send({ type: 'create', name: '共有卓' });
    const first = await host.wait('welcome');
    assert.equal(first.type, 'welcome');
    await guest.send({ type: 'join', room: first.room.id });
    const second = await guest.wait('welcome');
    assert.equal(second.type, 'welcome');
    await absent.send({ type: 'join', room: first.room.id });
    const absentSeat = await absent.wait('welcome');
    assert.equal(absentSeat.type, 'welcome');
    await absent.close();
    await host.send({ type: 'ready', ready: true });
    await guest.send({ type: 'ready', ready: true });
    const started = await host.wait('state', message => message.state.phase === 'started');
    assert.equal(started.type, 'state');
    const fixed = started.state.startedPlayers;
    assert.deepEqual(fixed?.map(seat => seat.id), [first.playerId, second.playerId]);

    const gameHost = new DiceClient(servers.dicePort);
    const gameGuest = new DiceClient(servers.dicePort);
    sockets.push(gameHost.socket, gameGuest.socket);
    await gameHost.send({ type: 'join', room: first.room.id, token: first.token, dev: true });
    await gameGuest.send({ type: 'join', room: first.room.id, token: second.token, dev: true });
    const diceFirst = await gameHost.wait('welcome');
    const diceSecond = await gameGuest.wait('welcome');
    assert.equal(diceFirst.type, 'welcome');
    assert.equal(diceSecond.type, 'welcome');
    assert.equal(diceFirst.playerId, first.playerId);
    assert.equal(diceSecond.playerId, second.playerId);
    assert.equal(diceFirst.dev, false);
    assert.deepEqual(diceFirst.state.seats.map(seat => seat.id), fixed?.map(seat => seat.id));
    assert.equal(diceFirst.state.boardSeed, diceSecond.state.boardSeed);
    assert.deepEqual(diceFirst.match, diceSecond.match);
    assert.equal(diceFirst.match?.players[0]?.score, 80);
    assert.equal(diceFirst.match?.players[0]?.diceCount, 15);
    assert.deepEqual(diceFirst.match?.players[0]?.wallet, [{ denomination: 50, count: 1 }, { denomination: 10, count: 3 }]);

    const excluded = new DiceClient(servers.dicePort);
    sockets.push(excluded.socket);
    await excluded.send({ type: 'join', room: first.room.id, token: absentSeat.token });
    const excludedMessage = await excluded.wait('error');
    assert.equal(excludedMessage.type, 'error');
    assert.equal(excludedMessage.code, 'PARTICIPANT');

    const unknown = new DiceClient(servers.dicePort);
    sockets.push(unknown.socket);
    await unknown.send({ type: 'join', room: 'deadbeef' });
    const denied = await unknown.wait('error');
    assert.equal(denied.type, 'error');
    assert.equal(denied.code, 'NOT_FOUND');
  } finally {
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate();
    servers.close();
  }
});
