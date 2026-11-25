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

test('新たに完成したマスだけを一度精算し、失点を現在の残高までに抑える', () => {
  const occupied = new Map([[cellKey({ rowId: 'bonus', columnId: 'ruby' }), { row: 0, column: 0 }]]);
  const first = settleCompletedRows(board, occupied, state([20, 80]), 'p1', 'bonus');
  assert.equal(first.players[0]?.score, 40);
  assert.deepEqual(first.completedRows, ['bonus']);
  assert.equal(first.result, null, 'before 500, an unfinished board stays in play');

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

test('盤面に空きがあっても得点が500点に達した時点で対戦を終了する', () => {
  const partial = new Map([[cellKey({ rowId: 'bonus', columnId: 'ruby' }), { row: 0, column: 0 }]]);
  const below500 = settleCompletedRows(board, partial, state([479, 480]), 'p1', 'bonus');
  assert.equal(below500.players[0]?.score, 499);
  assert.equal(below500.result, null);

  const reached500 = settleCompletedRows(board, partial, state([480, 480]), 'p1', 'bonus');
  assert.equal(reached500.players[0]?.score, 500);
  assert.deepEqual(reached500.result, { status: 'won', highestScore: 500, winners: ['p1'] });
  assert.deepEqual(reached500.completedRows, ['bonus']);
  assert.deepEqual([...rankPlayers(reached500.players).values()], [1, 2]);

  const above500 = settleCompletedRows(board, partial, state([490, 480]), 'p1', 'bonus');
  assert.deepEqual(above500.result, { status: 'won', highestScore: 510, winners: ['p1'] });

  const complete = new Map(partial).set(cellKey({ rowId: 'penalty', columnId: 'sapphire' }), { row: 1, column: 1 });
  assert.equal(settleCompletedRows(board, complete, reached500, 'p2', 'penalty'), reached500,
    'no later placements can change the finished match');
});

test('精算で勝利点に達した首位が同点なら同率優勝として記録する', () => {
  const complete = new Set([cellKey({ rowId: 'bonus', columnId: 'ruby' })]);
  const tied = settleCompletedRows(board, complete, {
    ...state([500, 480, 400]),
  }, 'p2', 'bonus');
  assert.deepEqual(tied.result?.winners, ['p1', 'p2']);
  assert.deepEqual([...rankPlayers(tied.players).values()], [1, 1, 3]);
});

test('盤面が埋まったときに最高499点なら続行し、500点なら勝利を確定する', () => {
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
