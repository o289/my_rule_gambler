import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetLoader } from '../../features/casino-entry/ui/asset-loader';
import type { AssetProgress } from '../../features/casino-entry/ui/asset-loader';

test('実際に読み込みが完了したときだけ進捗が進み、失敗した処理だけを再試行する', async () => {
  let doorLoads = 0;
  let loungeLoads = 0;
  let finishDoor = () => {};
  const doors = new Promise<void>(resolve => { finishDoor = resolve; });
  const loader = createAssetLoader([
    { id: 'doors', load: () => { doorLoads += 1; return doors; } },
    { id: 'lounge', load: async () => { if (++loungeLoads === 1) throw new Error('network'); } },
  ]);
  const progress: AssetProgress[] = [];
  const track = (value: AssetProgress) => progress.push(value);
  const first = loader.run(track);
  assert.equal(loader.run(track), first);
  assert.deepEqual(loader.getProgress(), { loaded: 0, total: 2 });
  finishDoor();
  assert.deepEqual(await first, ['lounge']);
  assert.deepEqual(loader.getProgress(), { loaded: 1, total: 2 });
  assert.deepEqual(await loader.run(track), []);
  assert.deepEqual(progress.map(value => value.loaded), [0, 1, 1, 2]);
  assert.deepEqual([doorLoads, loungeLoads], [1, 2]);
});
