import ruby from '../../../shared/assets/gems/ruby.webp';
import sapphire from '../../../shared/assets/gems/sapphire.webp';
import emerald from '../../../shared/assets/gems/emerald.webp';
import amethyst from '../../../shared/assets/gems/amethyst.webp';
import topaz from '../../../shared/assets/gems/topaz.webp';
import diamond from '../../../shared/assets/gems/diamond.webp';
import { createAssetLoader, decodeImage } from './asset-loader';
import doors from '../../../shared/assets/casino-entry/casino-doors.webp';
import lounge from '../../../shared/assets/casino-entry/casino-lounge.webp';

const gems = { ruby, sapphire, emerald, amethyst, topaz, diamond };
export const entranceGems = Object.entries(gems).map(([id, image]) => ({ id, image }));
const images = [
  { id: 'doors', image: doors },
  { id: 'lounge', image: lounge },
  ...entranceGems,
];

export const casinoAssets = createAssetLoader(images.map(({ id, image }) => ({ id, load: () => decodeImage(image) })));
