import ruby from '../../../shared/assets/gems/ruby.webp';
import sapphire from '../../../shared/assets/gems/sapphire.webp';
import emerald from '../../../shared/assets/gems/emerald.webp';
import amethyst from '../../../shared/assets/gems/amethyst.webp';
import topaz from '../../../shared/assets/gems/topaz.webp';
import diamond from '../../../shared/assets/gems/diamond.webp';

export const GEMS = {
  ruby: { name: 'ルビー', image: ruby, color: '#ff566e' },
  sapphire: { name: 'サファイア', image: sapphire, color: '#6294ff' },
  emerald: { name: 'エメラルド', image: emerald, color: '#50e7a2' },
  amethyst: { name: 'アメジスト', image: amethyst, color: '#c587ff' },
  topaz: { name: 'トパーズ', image: topaz, color: '#ffc26a' },
  diamond: { name: 'ダイヤモンド', image: diamond, color: '#eef3ff' },
} as const;

export type GemId = keyof typeof GEMS;

export const GEM_IDS: readonly GemId[] = ['ruby', 'sapphire', 'emerald', 'amethyst', 'topaz', 'diamond'];
