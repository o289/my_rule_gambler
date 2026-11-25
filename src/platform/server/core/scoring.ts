import { cellKey, goalColumn } from '../../../features/board/model/board-model';
import type { BoardDefinition } from '../../../features/board/model/board-model';
import type { MatchResult, MatchWalletGroup } from '../../../shared/contracts/dice';

export interface ScorePlayer {
  readonly id: string;
  readonly score: number;
  readonly wallet: readonly MatchWalletGroup[];
}

export interface ScoringState {
  readonly players: readonly ScorePlayer[];
  readonly completedRows: readonly string[];
  readonly result: MatchResult | null;
}

function walletForBalance(balance: number): readonly MatchWalletGroup[] {
  let remaining = balance;
  const groups: MatchWalletGroup[] = [];
  for (const denomination of [100, 50, 10] as const) {
    const count = Math.floor(remaining / denomination);
    if (count) groups.push({ denomination, count });
    remaining -= count * denomination;
  }
  return groups;
}

export function settleCompletedRows(
  definition: BoardDefinition,
  board: Pick<ReadonlySet<string>, 'has'>,
  state: ScoringState,
  playerId: string,
  placedRowId: string,
  victoryPoints = 500,
): ScoringState {
  if (state.result) return state;
  const completed = new Set(state.completedRows);
  const row = definition.rows.find(item => item.id === placedRowId);
  const goal = row ? goalColumn(definition, row) : undefined;
  if (!row || completed.has(row.id) || !goal || !board.has(cellKey({ rowId: row.id, columnId: goal.id }))) return state;
  const scorerIndex = state.players.findIndex(player => player.id === playerId);
  const scorer = state.players[scorerIndex];
  if (!scorer) return state;
  const paid = row.score < 0 ? Math.min(Math.abs(row.score), scorer.score) : 0;
  const score = scorer.score + (row.score > 0 ? row.score : -paid);
  const players = state.players.map((player, index) => index === scorerIndex
    ? { ...scorer, score, wallet: walletForBalance(score) }
    : player);
  completed.add(row.id);

  const highestScore = Math.max(...players.map(player => player.score));
  if (highestScore >= victoryPoints) {
    return { players, completedRows: [...completed], result: {
      status: 'won', highestScore, winners: players.filter(player => player.score === highestScore).map(player => player.id),
    } };
  }
  const roundComplete = definition.rows.every(row => {
    const rowGoal = goalColumn(definition, row);
    return rowGoal !== undefined && board.has(cellKey({ rowId: row.id, columnId: rowGoal.id }));
  });
  const result: MatchResult | null = roundComplete ? { status: 'continue', highestScore, winners: [] } : null;
  return { players, completedRows: [...completed], result };
}
