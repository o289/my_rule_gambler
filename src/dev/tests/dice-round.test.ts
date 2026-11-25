import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dealRoundDice } from '../../platform/server/core/dice-round';

test('ラウンドの再配布ではダイスを重複なく席順に配り、4人対戦の余りは未使用にする', () => {
  const ids = Array.from({ length: 30 }, (_, index) => `die-${String(index + 1).padStart(2, '0')}`);
  const distribution = dealRoundDice(ids, 4, 7);
  assert.ok(distribution);
  assert.deepEqual(distribution.hands.map(hand => hand.length), [7, 7, 7, 7]);
  assert.deepEqual(distribution.unused, ids.slice(28));
  assert.deepEqual([...distribution.hands.flat(), ...distribution.unused].sort(), [...ids].sort());
  assert.equal(new Set(distribution.hands.flat().concat(distribution.unused)).size, 30);
  assert.equal(dealRoundDice([...ids.slice(0, 29), 'die-01'], 4, 7), null, 'duplicate/lost IDs cannot enter a new round');
});

test('固定配布は人数分を確保し、公式配布分の未使用ダイスを保ったまま再配布する', () => {
  const ids = Array.from({ length: 34 }, (_, index) => `die-${String(index + 1).padStart(3, '0')}`);
  const distribution = dealRoundDice(ids, 2, 17);
  assert.ok(distribution);
  assert.deepEqual(distribution.hands.map(hand => hand.length), [17, 17]);
  assert.equal(distribution.unused.length, 0);
  assert.deepEqual(distribution.hands.flat().sort(), [...ids].sort());
  assert.equal(dealRoundDice(ids.slice(0, 30), 2, 17), null, '不足分のダイスでは開始できない');
});
