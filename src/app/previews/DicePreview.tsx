import { canPlaceGem, cellKey, initialState, nextOpenCell, requiredGemAt } from '../../features/board/model/board-model';
import type { BoardDefinition, BoardState, CellAddress } from '../../features/board/model/board-model';
import { createGoalBoard } from '../../features/board/model/goal-layout';
import type { DiceBoardAdapter, DiceBoardContext } from '../../features/dice/ui/main';
import DiceScreen from '../../features/dice/ui/main';
import type { DiceResult } from '../../shared/contracts/dice';
import { SAMPLE_BOARD } from '../../dev/preview-data/sample-board';
import { DiceConnection } from '../../features/dice/ui/connection';
import { casinoTokenStorageKey } from '../../features/casino-entry/ui/connection';

const params = new URLSearchParams(location.search);
const gameRoom = params.get('game') === 'dice';
const room = (params.get('room') ?? 'salon').toLowerCase();
const casinoToken = gameRoom ? (() => {
  try { return sessionStorage.getItem(casinoTokenStorageKey(room)) ?? undefined; }
  catch { return undefined; }
})() : undefined;
const connection = new DiceConnection(!gameRoom && params.get('dev') === '1', room, casinoToken);
const legacyDefinition = { ...SAMPLE_BOARD, rows: SAMPLE_BOARD.rows.map(row => ({ id: row.id, score: row.score })) };

function createBoardState(definition: BoardDefinition, game: DiceBoardContext['game'], active: DiceResult | undefined): BoardState {
  const state = initialState(definition);
  const occupied = new Map(state.occupied);
  for (const { row, column, gem } of game?.placements ?? []) {
    const rowId = definition.rows[row]?.id;
    const columnId = definition.columns[column]?.id;
    if (rowId && columnId) occupied.set(cellKey({ rowId, columnId }), gem);
  }
  const selection = active ? definition.rows.map(row => nextOpenCell(definition, occupied, row.id))
    .find(cell => cell && requiredGemAt(definition, cell) === active.gem) ?? null : null;
  return { ...state, occupied, selection };
}

function onSelect(cell: CellAddress, context: DiceBoardContext) {
  const { canAct, inPlacement, roll, selected, board, definition } = context;
  if (!canAct || !inPlacement || !roll || !selected || !canPlaceGem(definition, board.occupied, cell, selected.gem)) return;
  const row = definition.rows.findIndex(item => item.id === cell.rowId);
  const column = definition.columns.findIndex(item => item.id === cell.columnId);
  connection.send({ type: 'place', row, column, rollId: roll.id, dieId: selected.id });
}

const boardAdapter: DiceBoardAdapter = {
  getDefinition: seed => seed === undefined ? legacyDefinition : createGoalBoard(seed),
  createState: createBoardState,
  onSelect,
};

export default function DicePreview() {
  return <DiceScreen connection={connection} boardAdapter={boardAdapter} />;
}
