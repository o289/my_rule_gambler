import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellKey, initialState, playableColumns, requiredGemAt } from '../../features/board/model/board-model';
import { createGoalBoard } from '../../features/board/model/goal-layout';
import { confirmedPlacement, placementCandidates } from '../../features/dice/model/placement-feedback';
import { DEFAULT_CONFIG } from '../../shared/contracts/dice';
import type { GameState } from '../../shared/contracts/dice';

test('得点以外のマスや最終列も含め、配置可能なすべてのマスで配置演出を出せる', () => {
  const board = createGoalBoard(18);
  const occupied = new Map(initialState(board).occupied);
  const before: GameState = {
    seats: [], turnId: null, turnSequence: 1, turnNotice: null, phase: 'placement', revision: 1, config: DEFAULT_CONFIG, boardSeed: 18,
    placements: [], results: [], remaining: [], placedThisRoll: false, hasLegalPlacement: true,
  };
  let state = before;
  for (const [rowIndex, row] of board.rows.entries()) {
    for (const column of playableColumns(board, row)) {
      const cell = { rowId: row.id, columnId: column.id };
      const key = cellKey(cell);
      const gem = requiredGemAt(board, cell);
      assert.ok(gem);
      assert.ok(placementCandidates(board, occupied, gem).has(key));
      const placement = { row: rowIndex, column: board.columns.indexOf(column), gem };
      const next = { ...state, revision: state.revision + 1, placements: [...state.placements, placement] };
      assert.deepEqual(confirmedPlacement(state, next), { ...placement, revision: next.revision });
      assert.equal(confirmedPlacement(next, next), null);
      assert.equal(confirmedPlacement(null, next), null);
      assert.equal(confirmedPlacement(state, { ...next, boardSeed: 19 }), null);
      assert.equal(confirmedPlacement(state, { ...next, revision: state.revision + 2 }), null);
      occupied.set(key, gem);
      assert.ok(!placementCandidates(board, occupied, gem).has(key));
      state = next;
    }
  }
  assert.equal(state.placements.length, 21);
});

test('選んだ宝石に合う候補を複数の行で強調し、配置不可マスと埋まったマスを除く', () => {
  const board = {
    columns: [{ id: 'left', gem: 'ruby' }, { id: 'right', gem: 'ruby' }],
    rows: [
      { id: 'open', score: 10 },
      { id: 'blocked', score: 20, cells: { left: { blocked: true } } },
      { id: 'filled', score: 50, cells: { left: { gem: 'ruby' } } },
    ],
  } as const;
  const occupied = initialState(board).occupied;
  assert.deepEqual([...placementCandidates(board, occupied, 'ruby')], [
    cellKey({ rowId: 'open', columnId: 'left' }),
    cellKey({ rowId: 'blocked', columnId: 'right' }),
    cellKey({ rowId: 'filled', columnId: 'right' }),
  ]);
});
