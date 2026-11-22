import type { BoardDefinition } from '../../features/board/model/board-model';
import { GEM_IDS } from '../../features/board/model/gem-ids';

export const SAMPLE_BOARD: BoardDefinition = {
  columns: GEM_IDS.map(gem => ({ id: gem, gem })),
  rows: [
    {
      id: 'royal', score: 100,
      cells: { ruby: { gem: 'ruby' }, sapphire: { gem: 'sapphire' }, emerald: { gem: 'emerald' } },
    },
    {
      id: 'fifty', score: 50,
      cells: { ruby: { gem: 'emerald' }, sapphire: { gem: 'sapphire' }, topaz: { gem: 'topaz' } },
    },
    { id: 'thirty', score: 30, cells: { ruby: { gem: 'ruby' }, diamond: { blocked: false } } },
    { id: 'twenty', score: 20, cells: { diamond: { gem: 'diamond' } } },
    { id: 'ten', score: 10, cells: { amethyst: { gem: 'amethyst' } } },
    { id: 'penalty', score: -10, cells: { diamond: { blocked: false } } },
  ],
};
