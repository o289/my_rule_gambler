import type { BoardDefinition } from '../../features/board/model/board-model';
import { GEM_IDS } from '../../features/board/model/gem-ids';

export const SAMPLE_BOARD: BoardDefinition = {
  columns: GEM_IDS.map(gem => ({ id: gem, gem })),
  rows: [
    {
      id: 'royal', score: 100, goalColumnId: 'diamond',
      cells: { ruby: { gem: 'ruby' }, sapphire: { gem: 'sapphire' }, emerald: { gem: 'emerald' } },
    },
    {
      id: 'fifty', score: 50, goalColumnId: 'topaz',
      cells: { ruby: { gem: 'emerald', requiredGem: 'emerald' }, sapphire: { gem: 'sapphire' } },
    },
    { id: 'thirty', score: 30, goalColumnId: 'amethyst', cells: { ruby: { gem: 'ruby' }, emerald: { requiredGem: 'sapphire' } } },
    { id: 'twenty', score: 20, goalColumnId: 'emerald' },
    { id: 'ten', score: 10, goalColumnId: 'sapphire', cells: { sapphire: { requiredGem: 'ruby' } } },
    { id: 'penalty', score: -10, goalColumnId: 'ruby' },
  ],
};
