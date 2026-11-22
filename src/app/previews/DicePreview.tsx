import { cellKey, initialState } from '../../features/board/model/board-model';
import type { BoardState, CellAddress } from '../../features/board/model/board-model';
import type { DiceBoardAdapter, DiceBoardContext } from '../../features/dice/ui/main';
import DiceScreen from '../../features/dice/ui/main';
import { boardCellKey } from '../../features/dice/model/geometry';
import type { DiceResult } from '../../shared/contracts/dice';
import { SAMPLE_BOARD } from '../../dev/preview-data/sample-board';
import { DiceConnection } from '../../features/dice/ui/connection';

const params = new URLSearchParams(location.search);
const connection = new DiceConnection(params.get('dev') === '1', params.get('room') ?? 'salon');
const definition = { ...SAMPLE_BOARD, rows: SAMPLE_BOARD.rows.map(row => ({ id: row.id, score: row.score })) };
const idleState = initialState(definition);
const noPlacements = [] as const;

function createBoardState(game: DiceBoardContext['game'], active: DiceResult | undefined): BoardState {
  const occupied = new Map(idleState.occupied);
  const placements = game?.placements ?? noPlacements;
  const slots = new Set(placements.map(item => boardCellKey(item.row, item.column)));
  for (const { row, column, gem } of placements) {
    const rowId = definition.rows[row]?.id;
    const columnId = definition.columns[column]?.id;
    if (rowId && columnId) occupied.set(cellKey({ rowId, columnId }), gem);
  }
  const selection = active ? definition.rows.flatMap((row, rowIndex) => {
    const next = definition.columns.findIndex((_, column) => !slots.has(boardCellKey(rowIndex, column)));
    const column = definition.columns[next];
    return column?.gem === active.gem ? [{ rowId: row.id, columnId: column.id }] : [];
  })[0] ?? null : null;
  return { ...idleState, occupied, selection };
}

function onSelect(cell: CellAddress, context: DiceBoardContext) {
  const { canAct, inPlacement, roll, selected, board } = context;
  if (!canAct || !inPlacement || !roll || !selected) return;
  const row = definition.rows.findIndex(item => item.id === cell.rowId);
  const next = definition.columns.find(column => !board.occupied.has(cellKey({ rowId: cell.rowId, columnId: column.id })));
  if (row < 0 || next?.id !== cell.columnId || next.gem !== selected.gem) return;
  connection.send({ type: 'place', row, rollId: roll.id, dieId: selected.id });
}

const boardAdapter: DiceBoardAdapter = {
  definition,
  createState: createBoardState,
  onSelect,
};

export default function DicePreview() {
  return <DiceScreen connection={connection} boardAdapter={boardAdapter} />;
}
