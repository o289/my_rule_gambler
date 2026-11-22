import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canPlaceGem, canSelect, cellKey, goalColumn, initialState, nextOpenCell, playableColumns, requiredGemAt, updateBoard,
} from '../../features/board/model/board-model';
import type { BoardDefinition } from '../../features/board/model/board-model';
import { createGoalBoard } from '../../features/board/model/goal-layout';

test('the same seed produces stable goals, with six row lengths and increasing default scores', () => {
  const layouts = new Set<string>();
  for (const seed of [0, 1, 2, 74, 9010, 0xffff_ffff]) {
    const board = createGoalBoard(seed);
    assert.deepEqual(board, createGoalBoard(seed));
    const rows = board.rows.map(row => ({ row, length: playableColumns(board, row).length }));
    rows.sort((left, right) => left.length - right.length);
    assert.deepEqual(rows.map(item => item.length), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(rows.map(item => item.row.score), [-10, 10, 20, 30, 50, 100]);
    layouts.add(board.rows.map(row => row.goalColumnId).join(','));
    for (const { row, length } of rows) {
      assert.equal(goalColumn(board, row)?.id, board.columns[length - 1]?.id);
      for (const column of board.columns.slice(length)) {
        const cell = { rowId: row.id, columnId: column.id };
        assert.equal(canSelect(board, cell), false);
        assert.equal(requiredGemAt(board, cell), undefined);
      }
    }
  }
  assert.ok(layouts.size > 1);
});

test('goals, skipped blocked cells and designated gems work with both current and legacy rows', () => {
  const board: BoardDefinition = {
    columns: [
      { id: 'first', gem: 'ruby' },
      { id: 'middle', gem: 'sapphire' },
      { id: 'end', gem: 'amethyst' },
      { id: 'outside', gem: 'diamond' },
    ],
    rows: [
      { id: 'current', goalColumnId: 'end', score: 30,
        cells: { middle: { blocked: true }, end: { requiredGem: 'ruby' }, outside: { gem: 'diamond' } } },
      { id: 'legacy', score: 20, cells: { outside: { blocked: true } } },
      { id: 'empty', goalColumnId: 'unknown', score: 0 },
    ],
  };
  const [current, legacy, empty] = board.rows;
  assert.ok(current && legacy && empty);
  assert.equal(goalColumn(board, legacy)?.id, 'end');
  assert.equal(goalColumn(board, empty), undefined);

  const first = { rowId: current.id, columnId: 'first' };
  const end = { rowId: current.id, columnId: 'end' };
  const outside = { rowId: current.id, columnId: 'outside' };
  const state = initialState(board);
  assert.equal(state.occupied.has(cellKey(outside)), false);
  assert.equal(canSelect(board, outside), false);
  assert.equal(canPlaceGem(board, state.occupied, outside, 'diamond'), false);
  assert.equal(requiredGemAt(board, end), 'ruby');
  assert.equal(canPlaceGem(board, state.occupied, end, 'ruby'), false);

  const wrong = { ...state, selection: first, gem: 'sapphire' as const };
  assert.equal(updateBoard(board, wrong, { type: 'place' }), wrong);
  const skipped = { ...state, selection: end };
  assert.equal(updateBoard(board, skipped, { type: 'place' }), skipped);
  const placed = updateBoard(board, { ...state, selection: first }, { type: 'place' });
  assert.equal(placed.occupied.get(cellKey(first)), 'ruby');
  assert.deepEqual(nextOpenCell(board, placed.occupied, current.id), end);
  const full = updateBoard(board, { ...placed, selection: end }, { type: 'place' });
  assert.equal(full.occupied.get(cellKey(end)), 'ruby');
  assert.equal(nextOpenCell(board, full.occupied, current.id), undefined);
});
