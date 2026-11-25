import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dealRoundDice } from '../../platform/server/core/dice-round';

test('ラウンドの再配布ではダイスを重複なく席順に配り、4人対戦の余りは未使用にする', () => {
  const ids = Array.from({ length: 30 }, (_, index) => `die-${String(index + 1).padStart(2, '0')}`);
  const distribution = dealRoundDice(ids, 4);
  assert.ok(distribution);
  assert.deepEqual(distribution.hands.map(hand => hand.length), [7, 7, 7, 7]);
  assert.deepEqual(distribution.unused, ids.slice(28));
  assert.deepEqual([...distribution.hands.flat(), ...distribution.unused].sort(), [...ids].sort());
  assert.equal(new Set([...distribution.hands.flat(), ...distribution.unused]).size, 30);
  assert.equal(dealRoundDice([...ids.slice(0, 29), 'die-01'], 4), null, 'duplicate/lost IDs cannot enter a new round');
});
