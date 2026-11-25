export const VICTORY_POINT_OPTIONS = [300, 500, 700, 1000, 1200, 1500, 2000] as const;
export const STARTING_DICE_OPTIONS = ['official', 8, 10, 12, 15, 17] as const;
export const OFFICIAL_DICE_TOTAL = 30;
export const MAX_STARTING_DICE_TOTAL = 102;

export type VictoryPoints = typeof VICTORY_POINT_OPTIONS[number];
export type StartingDice = typeof STARTING_DICE_OPTIONS[number];

export interface GameRules {
  readonly victoryPoints: VictoryPoints;
  readonly startingDice: StartingDice;
}

export const DEFAULT_GAME_RULES: GameRules = { victoryPoints: 500, startingDice: 'official' };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isGameRules(value: unknown): value is GameRules {
  if (!record(value)) return false;
  const rules = value;
  return typeof rules.victoryPoints === 'number' && VICTORY_POINT_OPTIONS.some(option => option === rules.victoryPoints)
    && (rules.startingDice === 'official' || typeof rules.startingDice === 'number'
      && STARTING_DICE_OPTIONS.some(option => option === rules.startingDice));
}

export function dicePerPlayer(rules: GameRules, playerCount: number) {
  return rules.startingDice === 'official'
    ? Math.floor(OFFICIAL_DICE_TOTAL / playerCount)
    : rules.startingDice;
}

export function totalStartingDice(rules: GameRules, playerCount: number) {
  return rules.startingDice === 'official'
    ? OFFICIAL_DICE_TOTAL
    : Math.max(OFFICIAL_DICE_TOTAL, rules.startingDice * playerCount);
}
