import { SAMPLE_BOARD } from '../../../dev/preview-data/sample-board';
import { canSelect, cellKey, initialState } from '../../board/model/board-model';
import type { BoardDefinition, CellAddress } from '../../board/model/board-model';
import type { GemId } from '../../board/model/gems';

export const LAST_CELL: CellAddress = { rowId: 'royal', columnId: 'amethyst' };
export const COMEBACK_GEM = 'amethyst';
const targetScore = 100;

export const COMEBACK_BOARD: BoardDefinition = {
  ...SAMPLE_BOARD,
  rows: SAMPLE_BOARD.rows.map(row => row.id === LAST_CELL.rowId
    ? { ...row, score: targetScore, cells: { ...row.cells, topaz: { blocked: true }, diamond: { blocked: true } } }
    : row),
};

export const COMEBACK_SCORE = targetScore;
export const TURN_PLAYERS = [
  { name: 'PLAYER 1', score: 320 },
  { name: 'PLAYER 2', score: 390 },
  { name: 'PLAYER 3', score: 360 },
] as const;
export const [CURRENT_PLAYER, NEXT_PLAYER] = TURN_PLAYERS;
const opponents = TURN_PLAYERS.slice(1).sort((left, right) => right.score - left.score);
export const TURN_COMEBACK_RANK = {
  playerName: CURRENT_PLAYER.name,
  opponents: opponents.map(player => player.name),
  fromRank: 1 + opponents.filter(player => player.score > CURRENT_PLAYER.score).length,
  toRank: 1,
};

export const RETAINED_GEM: GemId = 'emerald';
export const REROLL_RESULTS = { available: 'ruby', blocked: 'diamond' } as const;
const rerollInitialBoard = initialState(SAMPLE_BOARD);

export function rerollTargets(gem: GemId): readonly CellAddress[] {
  const targets: CellAddress[] = [];
  for (const row of SAMPLE_BOARD.rows) {
    const column = SAMPLE_BOARD.columns.find(entry => {
      const cell = { rowId: row.id, columnId: entry.id };
      return canSelect(SAMPLE_BOARD, cell) && !rerollInitialBoard.occupied.has(cellKey(cell));
    });
    if (column?.gem === gem) targets.push({ rowId: row.id, columnId: column.id });
  }
  return targets;
}
