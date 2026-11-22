export const GEM_IDS = ['ruby', 'sapphire', 'emerald', 'amethyst', 'topaz', 'diamond'] as const;
export type GemId = (typeof GEM_IDS)[number];
