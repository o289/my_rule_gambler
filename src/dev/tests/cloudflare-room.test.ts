import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRoomObject } from '../../platform/cloudflare/game-room';

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put(key: string, value: unknown) { this.values.set(key, value); }
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
