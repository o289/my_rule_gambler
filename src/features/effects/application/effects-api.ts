import { REROLL_RESULTS } from '../model/effect-turn';
import { DEMO, readEffect } from '../model/effect-model';
import type { EffectCall, EffectKind } from '../model/effect-model';
import { EffectPlayer } from './effect-player';
import { SoundManager } from '../ui/sound';
import { preloadDice } from '../../dice/ui/face-canvases';

export const sound = new SoundManager();
export const player = new EffectPlayer(sound);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let playSequence = 0;

function startPlayback(request: ReturnType<typeof readEffect>) {
  const sequence = ++playSequence;
  const start = () => {
    if (sequence === playSequence) player.play(request, reduceMotion());
  };
  if (request.kind === 'DICE_STOP') {
    player.reset();
    void preloadDice().then(start, start);
    return;
  }
  if (request.kind === 'ONE_CELL_COMEBACK' || request.kind === 'REROLL_THROW') {
    void preloadDice().catch(() => undefined);
  }
  start();
}

export function playEffect(...[kind, params]: EffectCall) {
  startPlayback(readEffect(kind, params));
}

export function playDemo(kind: EffectKind, reroll: keyof typeof REROLL_RESULTS = 'available') {
  const params = kind === 'REROLL_THROW' ? { gem: REROLL_RESULTS[reroll] } : DEMO[kind];
  startPlayback(readEffect(kind, params));
}

export const effectActions = {
  playEffect,
  replay: () => {
    const snapshot = player.getSnapshot();
    if (snapshot) startPlayback(snapshot.request);
  },
  skip: () => player.skip(),
  reset: () => {
    playSequence += 1;
    player.reset();
  },
};
