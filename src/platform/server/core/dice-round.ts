export interface DiceRoundDistribution {
  readonly hands: readonly (readonly string[])[];
  readonly unused: readonly string[];
}

export function dealRoundDice(ids: readonly string[], playerCount: number): DiceRoundDistribution | null {
  if (ids.length !== 30 || new Set(ids).size !== 30 || !Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) return null;
  const perPlayer = Math.floor(ids.length / playerCount);
  return {
    hands: Array.from({ length: playerCount }, (_, index) => ids.slice(index * perPlayer, (index + 1) * perPlayer)),
    unused: ids.slice(perPlayer * playerCount),
  };
}
