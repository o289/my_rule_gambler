import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardDefinition } from '../../features/board/model/board-model';
import { cellKey } from '../../features/board/model/board-model';
import { rankPlayers } from '../../features/players/model/player-data';
import { settleCompletedRows } from '../../platform/server/core/scoring';
import type { ScoringState } from '../../platform/server/core/scoring';

const board: BoardDefinition = {
  columns: [{ id: 'ruby', gem: 'ruby' }, { id: 'sapphire', gem: 'sapphire' }],
  rows: [
    { id: 'bonus', score: 20, goalColumnId: 'ruby' },
    { id: 'penalty', score: -50, goalColumnId: 'sapphire' },
  ],
};

function player(id: string, score: number) {
  let remaining = score;
  const wallet = [];
  for (const denomination of [100, 50, 10] as const) {
    const count = Math.floor(remaining / denomination);
    if (count) wallet.push({ denomination, count });
    remaining -= count * denomination;
  }
  return { id, score, wallet };
}

function state(scores: readonly number[], completedRows: readonly string[] = []): ScoringState {
  return { players: scores.map((score, index) => player(`p${index + 1}`, score)), completedRows, result: null };
}

test('settlement applies only the newly completed goal once and caps a loss at the current balance', () => {
  const occupied = new Map([[cellKey({ rowId: 'bonus', columnId: 'ruby' }), { row: 0, column: 0 }]]);
  const first = settleCompletedRows(board, occupied, state([20, 80]), 'p1', 'bonus');
  assert.equal(first.players[0]?.score, 40);
  assert.deepEqual(first.completedRows, ['bonus']);
  assert.equal(first.result, null, '500 is not checked before every goal is full');

  const repeated = settleCompletedRows(board, occupied, first, 'p1', 'bonus');
  assert.equal(repeated.players[0]?.score, 40, 'a completed row cannot be paid twice');

  const withOtherGoal = new Map(occupied).set(cellKey({ rowId: 'penalty', columnId: 'sapphire' }), { row: 1, column: 1 });
  const loss = settleCompletedRows(board, withOtherGoal, state([20, 80]), 'p1', 'penalty');
  assert.equal(loss.players[0]?.score, 0, 'a loss larger than the balance pays the remaining balance only');
  assert.equal(loss.players[0]?.wallet.reduce((sum, group) => sum + group.denomination * group.count, 0), 0);
  assert.equal(loss.result?.status, 'continue');
  assert.equal(loss.result?.highestScore, 80);

  const zeroBalanceLoss = settleCompletedRows(board, withOtherGoal, state([0, 80]), 'p1', 'penalty');
  assert.equal(zeroBalanceLoss.players[0]?.score, 0);
  assert.deepEqual(zeroBalanceLoss.completedRows, ['penalty'], 'a zero-payment loss is still settled once');
});

test('only a completed board decides 500-point victory and preserves tied highest players', () => {
  const partial = new Map([[cellKey({ rowId: 'bonus', columnId: 'ruby' }), { row: 0, column: 0 }]]);
  const reached500 = settleCompletedRows(board, partial, state([480, 480]), 'p1', 'bonus');
  assert.equal(reached500.players[0]?.score, 500);
  assert.equal(reached500.result, null, 'reaching 500 before the last goal does not end the game');

  const complete = new Map(partial).set(cellKey({ rowId: 'penalty', columnId: 'sapphire' }), { row: 1, column: 1 });
  const final = settleCompletedRows(board, complete, reached500, 'p2', 'penalty');
  assert.deepEqual(final.result, { status: 'won', highestScore: 500, winners: ['p1'] });
  assert.deepEqual([...rankPlayers(final.players).values()], [1, 2]);

  const tied = settleCompletedRows(board, complete, {
    ...reached500,
    players: [player('p1', 500), player('p2', 550), player('p3', 400)],
  }, 'p2', 'penalty');
  assert.deepEqual(tied.result?.winners, ['p1', 'p2']);
  assert.deepEqual([...rankPlayers(tied.players).values()], [1, 1, 3]);

  const lastPlacerLoses = settleCompletedRows(board, complete, {
    ...reached500,
    players: [player('p1', 600), player('p2', 551)],
  }, 'p2', 'penalty');
  assert.deepEqual(lastPlacerLoses.result?.winners, ['p1'], 'the player placing the last goal does not automatically win');
});

test('499 continues while 500 at board completion is a win', () => {
  const occupied = new Map([
    [cellKey({ rowId: 'bonus', columnId: 'ruby' }), { row: 0, column: 0 }],
    [cellKey({ rowId: 'penalty', columnId: 'sapphire' }), { row: 1, column: 1 }],
  ]);
  const at499 = settleCompletedRows(board, occupied, {
    ...state([529, 499]),
    completedRows: ['bonus'],
  }, 'p1', 'penalty');
  assert.deepEqual(at499.result, { status: 'continue', highestScore: 499, winners: [] });

  const at500 = settleCompletedRows(board, occupied, {
    ...state([550, 499]),
    completedRows: ['bonus'],
  }, 'p1', 'penalty');
  assert.deepEqual(at500.result, { status: 'won', highestScore: 500, winners: ['p1'] });

  const at501 = settleCompletedRows(board, occupied, {
    ...state([551, 499]),
    completedRows: ['bonus'],
  }, 'p1', 'penalty');
  assert.deepEqual(at501.result, { status: 'won', highestScore: 501, winners: ['p1'] });
});
