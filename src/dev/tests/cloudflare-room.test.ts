import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRoomObject } from '../../platform/cloudflare/game-room';

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put(key: string, value: unknown) { this.values.set(key, value); }
  async deleteAll() { this.values.clear(); }
  get size() { return this.values.size; }
}

test('GameRoomObject refuses a second metadata reservation for the same ID', async () => {
  const storage = new MemoryStorage();
  const object = new GameRoomObject({ storage, blockConcurrencyWhile: callback => callback() });
  const request = () => new Request('https://room.internal/__create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'a1b2c3d4', name: 'test room' }),
  });
  assert.equal((await object.fetch(request())).status, 201);
  assert.equal((await object.fetch(request())).status, 409);
});

test('GameRoomObject completes a pending dissolution before serving the old ID', async () => {
  const storage = new MemoryStorage();
  await storage.put('room', { id: 'a1b2c3d4', name: 'test room' });
  await storage.put('room-state', { version: 1 });
  await storage.put('room-status', 'closing');
  const object = new GameRoomObject({ storage, blockConcurrencyWhile: callback => callback() });
  const response = await object.fetch(new Request('https://room.internal/casino-ws?room=a1b2c3d4'));
  assert.equal(response.status, 404);
  assert.equal(storage.size, 0, 'the retry removes metadata, status, and snapshots together');
});

test('GameRoomObject keeps reading legacy rooms that have metadata but no saved game snapshot', async () => {
  const storage = new MemoryStorage();
  await storage.put('room', { id: 'a1b2c3d4', name: 'legacy room' });
  const object = new GameRoomObject({ storage, blockConcurrencyWhile: callback => callback() });
  const response = await object.fetch(new Request('https://room.internal/dice-ws?room=a1b2c3d4'));
  assert.equal(response.status, 426, 'the old room metadata still initializes an empty Room');
  assert.equal(storage.size, 1, 'a read-only compatibility check does not rewrite legacy data');
});

test('GameRoomObject blocks unknown snapshot versions instead of silently resetting the match', async () => {
  const storage = new MemoryStorage();
  const unknownSnapshot = { version: 2, marker: 'must remain intact' };
  await storage.put('room', { id: 'a1b2c3d4', name: 'newer snapshot' });
  await storage.put('room-state', unknownSnapshot);
  const object = new GameRoomObject({ storage, blockConcurrencyWhile: callback => callback() });
  const response = await object.fetch(new Request('https://room.internal/casino-ws?room=a1b2c3d4'));
  assert.equal(response.status, 503);
  assert.deepEqual(await storage.get('room-state'), unknownSnapshot);
});
