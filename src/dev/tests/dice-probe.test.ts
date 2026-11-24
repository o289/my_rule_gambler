import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';

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
  readonly frame?: { readonly rollId: string; readonly phase: string; readonly seq: number };
  readonly results?: readonly { readonly id: string; readonly gem: string }[];
  readonly metrics?: { readonly elapsedMs: number; readonly steps: number; readonly frames: number };
}

class ProbeClient {
  readonly socket: WebSocket;
  readonly events: ProbeEvent[] = [];

  constructor(port: number, room: string) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/dice-probe?room=${room}`);
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

test('STG dice probe streams matching physics frames and results to two clients in separate rooms', { timeout: 45_000 }, async () => {
  const worker = await unstableDev('src/platform/cloudflare/dice-probe/worker.ts', {
    config: 'wrangler.jsonc',
    env: 'stg',
    ip: '127.0.0.1',
    port: 0,
    local: true,
    inspect: false,
    persist: false,
    logLevel: 'error',
  });
  const clients = [
    new ProbeClient(worker.port, 'probe-a'), new ProbeClient(worker.port, 'probe-a'),
    new ProbeClient(worker.port, 'probe-b'), new ProbeClient(worker.port, 'probe-b'),
  ];
  try {
    await Promise.all(clients.map(client => client.open()));
    clients[0]!.send('a-initial', 'initial', ['a1', 'a2', 'a3', 'a4', 'a5']);
    clients[2]!.send('b-initial', 'initial', ['b1', 'b2', 'b3', 'b4', 'b5']);
    const firstWave = await Promise.all([
      clients[0]!.waitFor('finished', 'a-initial'), clients[1]!.waitFor('finished', 'a-initial'),
      clients[2]!.waitFor('finished', 'b-initial'), clients[3]!.waitFor('finished', 'b-initial'),
    ]);

    for (const [left, right, rollId] of [[clients[0]!, clients[1]!, 'a-initial'], [clients[2]!, clients[3]!, 'b-initial']] as const) {
      const leftFrames = eventsForRoll(left, rollId).filter(event => event.type === 'frame');
      const rightFrames = eventsForRoll(right, rollId).filter(event => event.type === 'frame');
      assert.deepEqual(leftFrames, rightFrames);
      assert.ok(leftFrames.length > 1, 'clients receive intermediate and final frames');
      assert.equal(leftFrames.at(-1)?.frame?.phase, 'settled');
    }
    assert.deepEqual(firstWave[0]!.results, firstWave[1]!.results);
    assert.deepEqual(firstWave[2]!.results, firstWave[3]!.results);
    assertReceivedResult(firstWave[0]!, ['a1', 'a2', 'a3', 'a4', 'a5']);
    assertReceivedResult(firstWave[2]!, ['b1', 'b2', 'b3', 'b4', 'b5']);
    assert.ok(firstWave[0]!.metrics?.elapsedMs && firstWave[0]!.metrics!.elapsedMs > 0);

    clients[0]!.send('a-reroll', 'reroll', ['a1', 'a2', 'a3', 'a4', 'a5']);
    clients[2]!.send('b-second', 'initial', ['b6', 'b7', 'b8', 'b9', 'b10']);
    const secondWave = await Promise.all([
      clients[0]!.waitFor('finished', 'a-reroll'), clients[1]!.waitFor('finished', 'a-reroll'),
      clients[2]!.waitFor('finished', 'b-second'), clients[3]!.waitFor('finished', 'b-second'),
    ]);
    assert.deepEqual(secondWave[0]!.results, secondWave[1]!.results);
    assert.deepEqual(secondWave[2]!.results, secondWave[3]!.results);
    assertReceivedResult(secondWave[0]!, ['a1', 'a2', 'a3', 'a4', 'a5']);
    assertReceivedResult(secondWave[2]!, ['b6', 'b7', 'b8', 'b9', 'b10']);
    for (const [left, right, rollId] of [[clients[0]!, clients[1]!, 'a-reroll'], [clients[2]!, clients[3]!, 'b-second']] as const) {
      const leftFrames = eventsForRoll(left, rollId).filter(event => event.type === 'frame');
      const rightFrames = eventsForRoll(right, rollId).filter(event => event.type === 'frame');
      assert.deepEqual(leftFrames, rightFrames);
      assert.equal(leftFrames.at(-1)?.frame?.phase, 'settled');
    }
    assert.equal(eventsForRoll(clients[1]!, 'b-second').length, 0);
    assert.equal(eventsForRoll(clients[3]!, 'a-reroll').length, 0);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await worker.stop();
  }
});
