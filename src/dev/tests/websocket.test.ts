import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startCasinoServer } from '../../platform/local-demo-servers/casino-entry/server/http';
import { parseJson, readServerMessage } from '../../shared/contracts/casino-entry';
import type { ServerMessage } from '../../shared/contracts/casino-entry';

function deniedUpgrade(url: string, origin: string) {
  const socket = new WebSocket(url, { headers: { origin } });
  socket.on('error', () => {});
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('upgrade rejection timed out'));
    }, 3000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error('unexpectedly accepted upgrade'));
    });
  });
}

test('shared WebSocket transport preserves origin/path checks and recovers after invalid JSON', { timeout: 8000 }, async () => {
  const server = await startCasinoServer({ port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    headers: { origin: 'http://localhost:5179' },
  });
  const received: ServerMessage[] = [];
  socket.on('message', raw => {
    const message = readServerMessage(parseJson(raw.toString()));
    assert.ok(message);
    received.push(message);
  });
  try {
    await once(socket, 'open');
    socket.send('{invalid json');
    const inputError = await waitFor(received, message => message.type === 'error' && message.code === 'INPUT');
    assert.equal(inputError.type, 'error');
    socket.send(JSON.stringify({ type: 'create', name: '検証テーブル' }));
    const welcome = await waitFor(received, message => message.type === 'welcome');
    assert.equal(welcome.type, 'welcome');
    assert.equal(welcome.room.name, '検証テーブル');
    const closed = once(socket, 'close');
    socket.close();
    await closed;

    assert.equal(await deniedUpgrade(`ws://127.0.0.1:${server.port}/wrong`, 'http://localhost:5179'), 403);
    assert.equal(await deniedUpgrade(`ws://127.0.0.1:${server.port}/ws`, 'https://example.com'), 403);
  } finally {
    socket.terminate();
    server.close();
  }
});

async function waitFor<T>(values: T[], predicate: (value: T) => boolean) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const value = values.find(predicate);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('WebSocket response timed out');
}
