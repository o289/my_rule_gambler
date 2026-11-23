import { cellKey, nextOpenCell, requiredGemAt } from '../../board/model/board-model';
import type { BoardDefinition } from '../../board/model/board-model';
import type { GemId } from '../../board/model/gem-ids';
import type { GameState, Placement } from '../../../shared/contracts/dice';

export interface PlacementFeedback extends Placement {
  revision: number;
}

export function confirmedPlacement(previous: GameState | null, next: GameState): PlacementFeedback | null {
  if (!previous || previous.boardSeed !== next.boardSeed || next.revision !== previous.revision + 1
    || next.placements.length !== previous.placements.length + 1) return null;

  const added = next.placements.filter(cell => !previous.placements.some(old => old.row === cell.row && old.column === cell.column));
  const placement = added.length === 1 ? added[0] : undefined;
  return placement ? { ...placement, revision: next.revision } : null;
}

export function placementCandidates(definition: BoardDefinition, occupied: ReadonlyMap<string, GemId>, gem: GemId) {
  const candidates = new Set<string>();
  for (const row of definition.rows) {
    const cell = nextOpenCell(definition, occupied, row.id);
    if (cell && requiredGemAt(definition, cell) === gem) candidates.add(cellKey(cell));
  }
  return candidates;
}
