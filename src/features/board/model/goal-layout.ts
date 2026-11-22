import { GEM_IDS } from './gem-ids';
import type { GemId } from './gem-ids';
import type { BoardDefinition } from './board-model';

const SCORE_BY_LENGTH = [-10, 10, 20, 30, 50, 100];
const PATTERNS: readonly (readonly GemId[])[] = [
  ['ruby', 'ruby', 'ruby', 'amethyst', 'amethyst', 'diamond'],
  ['sapphire', 'sapphire', 'topaz', 'emerald', 'sapphire', 'topaz'],
  ['emerald', 'emerald', 'topaz', 'topaz', 'emerald', 'emerald'],
  ['amethyst', 'diamond', 'amethyst', 'ruby', 'sapphire', 'diamond'],
  ['topaz', 'amethyst', 'emerald', 'sapphire', 'topaz', 'ruby'],
  ['diamond', 'diamond', 'diamond', 'diamond', 'diamond', 'diamond'],
];

const columns = GEM_IDS.map(gem => ({ id: gem, gem }));

export function createGoalBoard(seed: number): BoardDefinition {
  const goals = [...columns];
  let random = seed >>> 0;
  for (let index = goals.length - 1; index > 0; index -= 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const swap = Math.floor((random / 0x1_0000_0000) * (index + 1));
    const current = goals[index];
    const next = goals[swap];
    if (!current || !next) continue;
    goals[index] = next;
    goals[swap] = current;
  }

  return {
    columns,
    rows: goals.map((goal, row) => {
      const length = columns.indexOf(goal) + 1;
      return {
        id: `row-${row + 1}`,
        score: SCORE_BY_LENGTH[length - 1] ?? 0,
        goalColumnId: goal.id,
        cells: Object.fromEntries(columns.slice(0, length).map((column, index) => [
          column.id, { requiredGem: PATTERNS[row]?.[index] ?? column.gem },
        ])),
      };
    }),
  };
}
