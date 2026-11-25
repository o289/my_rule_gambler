export interface DiceRoundDistribution {
  readonly hands: readonly (readonly string[])[];
  readonly unused: readonly string[];
}

export function dealRoundDice(ids: readonly string[], playerCount: number, perPlayer: number): DiceRoundDistribution | null {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6
    || !Number.isInteger(perPlayer) || perPlayer < 1 || perPlayer > 17
    || ids.length !== Math.max(30, perPlayer * playerCount) || new Set(ids).size !== ids.length) return null;
  return {
    hands: Array.from({ length: playerCount }, (_, index) => ids.slice(index * perPlayer, (index + 1) * perPlayer)),
    unused: ids.slice(perPlayer * playerCount),
  };
}
