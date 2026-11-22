import { SAMPLE_BOARD } from './sample-board';
import { canSelect, cellKey, initialState } from '../../features/board/model/board-model';
import type { BoardDefinition, CellAddress } from '../../features/board/model/board-model';
import type { GemId } from '../../features/board/model/gems';
import type { EffectParams, EffectScenario } from '../../features/effects/model/effect-model';

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

export const DEMO: EffectParams = {
  DICE_STOP: { gem: 'sapphire' },
  GEM_PLACEMENT: { gem: 'amethyst', target: LAST_CELL },
  BIG_WIN: { playerName: 'PLAYER 1', points: 100, target: LAST_CELL },
  ONE_CELL_COMEBACK: { gem: COMEBACK_GEM },
  REROLL_THROW: { gem: REROLL_RESULTS.available },
  COMEBACK: { playerName: 'PLAYER 1', opponents: ['PLAYER 2', 'PLAYER 3'], fromRank: 3, toRank: 1 },
  JACKPOT_VICTORY: { playerName: 'PLAYER 1', gem: 'amethyst', target: LAST_CELL },
};

export const EFFECT_PREVIEW_SCENARIO: EffectScenario = {
  board: SAMPLE_BOARD,
  featuredCell: LAST_CELL,
  demo: DEMO,
  turn: {
    board: SAMPLE_BOARD,
    comebackBoard: COMEBACK_BOARD,
    lastCell: LAST_CELL,
    comebackGem: COMEBACK_GEM,
    comebackScore: COMEBACK_SCORE,
    players: TURN_PLAYERS,
    currentPlayer: CURRENT_PLAYER,
    nextPlayer: NEXT_PLAYER,
    comebackRank: TURN_COMEBACK_RANK,
    retainedGem: RETAINED_GEM,
    rerollResults: REROLL_RESULTS,
    rerollTargets,
  },
};
