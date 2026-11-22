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
    void preloadDice().then(start, start);
  } else start();
}

export function playEffect(...[kind, params]: EffectCall) {
  startPlayback(readEffect(kind, params));
}

export function playDemo(kind: EffectKind) {
  startPlayback(readEffect(kind, DEMO[kind]));
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
