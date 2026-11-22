import type { GemId } from "./gems";

export interface BoardCellSetup {
  gem?: GemId;
  blocked?: boolean;
}

export interface BoardRow {
  id: string;
  score: number;
  cells?: Readonly<Record<string, BoardCellSetup>>;
}

export interface BoardColumn {
  id: string;
  gem: GemId;
}

export interface BoardDefinition {
  rows: readonly BoardRow[];
  columns: readonly BoardColumn[];
}

export interface CellAddress {
  rowId: string;
  columnId: string;
}

export interface BoardAward {
  id: number;
  rowId: string;
  amount: number;
}

export interface BoardState {
  occupied: ReadonlyMap<string, GemId>;
  scores: ReadonlyMap<string, number>;
  selection: CellAddress | null;
  gem: GemId;
  placement: { cell: string; id: number } | null;
  award: BoardAward | null;
  result: BoardAward | null;
  nextId: number;
  resetId: number;
}

export type BoardAction =
  | { type: "select-cell"; cell: CellAddress }
  | { type: "select-gem"; gem: GemId }
  | { type: "place" }
  | { type: "remove" }
  | { type: "change-score"; rowId: string; score: number }
  | { type: "award" }
  | { type: "finish-award"; id: number }
  | { type: "reset" };

export function cellKey(cell: CellAddress) {
  return JSON.stringify([cell.rowId, cell.columnId]);
}

export function formatScore(score: number) {
  if (score < 0) return `−${Math.abs(score)}`;
  return score > 0 ? `+${score}` : "0";
}

export function canSelect(board: BoardDefinition, cell: CellAddress) {
  const row = board.rows.find((row) => row.id === cell.rowId);
  return Boolean(
    row &&
    board.columns.some((column) => column.id === cell.columnId) &&
    !row.cells?.[cell.columnId]?.blocked,
  );
}

export function initialState(
  board: BoardDefinition,
  nextId = 1,
  resetId = 0,
): BoardState {
  const occupied = new Map<string, GemId>();
  const scores = new Map<string, number>();
  let selection: CellAddress | null = null;
  let firstSelectable: CellAddress | null = null;
  for (const row of board.rows) {
    scores.set(row.id, row.score);
    for (const column of board.columns) {
      const cell = { rowId: row.id, columnId: column.id };
      const setup = row.cells?.[column.id];
      if (setup?.gem) occupied.set(cellKey(cell), setup.gem);
      if (setup?.blocked) continue;
      firstSelectable ??= cell;
      if (!setup?.gem) selection ??= cell;
    }
  }
  selection ??= firstSelectable;
  const gem =
    board.columns.find((column) => column.id === selection?.columnId)?.gem ??
    "ruby";
  return {
    occupied,
    scores,
    selection,
    gem,
    placement: null,
    award: null,
    result: null,
    nextId,
    resetId,
  };
}

export function updateBoard(
  board: BoardDefinition,
  state: BoardState,
  action: BoardAction,
): BoardState {
  switch (action.type) {
    case "select-cell":
      return canSelect(board, action.cell)
        ? { ...state, selection: action.cell }
        : state;
    case "select-gem":
      return { ...state, gem: action.gem };
    case "place": {
      if (!state.selection || !canSelect(board, state.selection)) return state;
      const cell = cellKey(state.selection);
      if (state.occupied.has(cell)) return state;
      const occupied = new Map(state.occupied).set(cell, state.gem);
      const placement = { cell, id: state.nextId };
      return { ...state, occupied, placement, nextId: state.nextId + 1 };
    }
    case "remove": {
      if (!state.selection || !canSelect(board, state.selection)) return state;
      const cell = cellKey(state.selection);
      if (!state.occupied.has(cell)) return state;
      const occupied = new Map(state.occupied);
      occupied.delete(cell);
      const placement = state.placement?.cell === cell ? null : state.placement;
      return { ...state, occupied, placement };
    }
    case "change-score": {
      if (
        state.award?.rowId === action.rowId ||
        !state.scores.has(action.rowId) ||
        !Number.isSafeInteger(action.score)
      )
        return state;
      const scores = new Map(state.scores).set(action.rowId, action.score);
      return { ...state, scores };
    }
    case "award": {
      if (!state.selection || state.award) return state;
      const rowId = state.selection.rowId;
      const amount = state.scores.get(rowId);
      if (amount === undefined) return state;
      const award = { id: state.nextId, rowId, amount };
      return { ...state, award, nextId: state.nextId + 1 };
    }
    case "finish-award":
      if (state.award?.id !== action.id) return state;
      return { ...state, result: state.award, award: null };
    case "reset":
      return initialState(board, state.nextId, state.resetId + 1);
  }
}
