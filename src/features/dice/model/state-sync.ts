import type { GameState } from '../../../shared/contracts/dice';

export function acceptsGameState(current: GameState | null, next: GameState) {
  return current === null || next.revision >= current.revision;
}
