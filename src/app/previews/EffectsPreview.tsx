import EffectsScreen from '../../features/effects/ui/main';
import { createEffectsRuntime } from '../../features/effects/application/effects-api';
import { SoundManager } from '../../features/effects/ui/sound';
import { preloadDice } from '../../features/dice/ui/face-canvases';
import { EFFECT_PREVIEW_SCENARIO } from '../../dev/preview-data/effect-turn';

const audio = new SoundManager();
const runtime = createEffectsRuntime({
  audio,
  scenario: EFFECT_PREVIEW_SCENARIO,
  preloadDice,
  reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
});

declare global {
  interface Window { gamblerEffects: typeof runtime.actions; }
}
window.gamblerEffects = Object.freeze(runtime.actions);

export default function EffectsPreview() {
  return <StrictMode><EffectsScreen runtime={runtime} /></StrictMode>;
}
import { StrictMode } from 'react';
