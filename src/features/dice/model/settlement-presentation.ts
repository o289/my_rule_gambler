import type { BoardDefinition, CellAddress } from '../../board/model/board-model';
import { goalColumn, nextOpenCell, requiredGemAt } from '../../board/model/board-model';
import type { DiceResult, MatchPlayerSetup, MatchSettlementEvent } from '../../../shared/contracts/dice';
import type { GemId } from '../../board/model/gem-ids';
import { readEffect, settlementEffects } from '../../effects/model/effect-model';
import type { EffectCall, EffectParams, EffectRequest } from '../../effects/model/effect-model';

export function settlementRankChange(event: MatchSettlementEvent): EffectParams['COMEBACK'] | undefined {
  const ranking = event.beforeRanks.flatMap(player => {
    const next = event.afterRanks.find(item => item.id === player.id);
    return next ? [{ id: player.id, name: player.name, fromRank: player.rank, toRank: next.rank }] : [];
  });
  const changed = ranking.filter(player => player.fromRank !== player.toRank);
  const target = changed.find(player => player.id === event.playerId) ?? changed[0];
  if (!target) return undefined;
  return {
    playerId: target.id,
    playerName: target.name,
    opponents: ranking.filter(player => player.id !== target.id).map(player => player.name),
    fromRank: target.fromRank,
    toRank: target.toRank,
    ranking,
  };
}

export function settlementFollowups(event: MatchSettlementEvent, board: BoardDefinition): EffectRequest[] {
  const target = { rowId: event.rowId, columnId: event.columnId } satisfies CellAddress;
  const score: EffectParams['BOARD_SCORE'] = { playerName: event.playerName, points: event.points, target };
  const rankChange = settlementRankChange(event);
  const followups = settlementEffects({ score, rankChange, gameEnded: event.gameEnded }).slice(1)
    .map(([kind, params]: EffectCall) => readEffect(kind, params, { board, featuredCell: target }));
  if (event.gameEnded) {
    const winners = event.afterRanks.filter(item => item.rank === 1);
    const winner = winners[0];
    if (winners.length === 1 && winner) {
      followups.push(readEffect('JACKPOT_VICTORY', { playerName: winner.name, gem: event.gem, target },
        { board, featuredCell: target }));
    }
  }
  return followups;
}

export type SettlementStage = { kind: 'placement' | 'score' | 'bank' } | { kind: 'effect'; request: EffectRequest };

export function settlementStages(event: MatchSettlementEvent, board: BoardDefinition): SettlementStage[] {
  const stages: SettlementStage[] = [{ kind: 'placement' }, { kind: 'score' }];
  const [first, ...rest] = settlementFollowups(event, board);
  if (first?.kind === 'BIG_WIN') stages.push({ kind: 'effect', request: first });
  if (event.points !== 0) stages.push({ kind: 'bank' });
  if (first && first.kind !== 'BIG_WIN') stages.push({ kind: 'effect', request: first });
  stages.push(...rest.map(request => ({ kind: 'effect' as const, request })));
  return stages;
}

export type DicePresentationMode = 'settlement' | 'result' | 'roll' | 'board';

export function dicePresentationMode(input: {
  settlementPending: boolean;
  settlementRollId: string | null;
  resultReady: boolean;
  rollReady: boolean;
  rollId: string | null;
}): DicePresentationMode {
  if (input.settlementPending) {
    if (input.rollReady && input.rollId !== null && input.rollId === input.settlementRollId) return 'roll';
    return 'settlement';
  }
  if (input.resultReady) return 'result';
  if (input.rollReady) return 'roll';
  return 'board';
}

export interface ComebackHint {
  readonly target: CellAddress;
  readonly gem: GemId;
  readonly points: number;
}

export function oneCellComebackHint(
  board: BoardDefinition,
  occupied: Pick<ReadonlySet<string>, 'has'>,
  players: readonly Pick<MatchPlayerSetup, 'id' | 'score'>[],
  playerId: string,
  results: readonly DiceResult[],
  remaining: readonly string[],
): ComebackHint | null {
  const player = players.find(item => item.id === playerId);
  const others = players.filter(item => item.id !== playerId);
  if (!player || !others.length || player.score > Math.max(...others.map(item => item.score))) return null;
  const otherHighest = Math.max(...others.map(item => item.score));
  for (const result of results) {
    if (!remaining.includes(result.id)) continue;
    for (const row of board.rows) {
      if (row.score <= 0) continue;
      const target = nextOpenCell(board, occupied, row.id);
      const goal = goalColumn(board, row);
      if (!target || !goal || target.columnId !== goal.id || requiredGemAt(board, target) !== result.gem) continue;
      if (player.score + row.score > otherHighest) return { target, gem: result.gem, points: row.score };
    }
  }
  return null;
}
