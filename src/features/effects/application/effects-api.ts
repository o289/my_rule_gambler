import { readEffect } from '../model/effect-model';
import type { EffectCall, EffectKind, EffectScenario } from '../model/effect-model';
import { EffectPlayer } from './effect-player';
import type { EffectAudio } from './effect-player';

export interface EffectsAudio extends EffectAudio {
  unlock(): void;
}

interface DemoOptions {
  reroll?: 'available' | 'blocked';
  otherTurn?: boolean;
  noPayment?: boolean;
}

export interface EffectsRuntime {
  player: EffectPlayer;
  audio: EffectsAudio;
  scenario: EffectScenario;
  playDemo: (kind: EffectKind, options?: DemoOptions) => void;
  actions: {
    playEffect: (...call: EffectCall) => void;
    replay: () => void;
    skip: () => void;
    reset: () => void;
  };
}

export function createEffectsRuntime({
  audio,
  scenario,
  preloadDice,
  reducedMotion,
}: {
  audio: EffectsAudio;
  scenario: EffectScenario;
  preloadDice: () => Promise<unknown>;
  reducedMotion: () => boolean;
}): EffectsRuntime {
  const player = new EffectPlayer(audio, scenario.turn);
  let playSequence = 0;

  function startPlayback(request: ReturnType<typeof readEffect>) {
    const sequence = ++playSequence;
    const start = () => {
      if (sequence === playSequence) player.play(request, reducedMotion());
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

  function read(kind: unknown, params: unknown) {
    return readEffect(kind, params, { board: scenario.board, featuredCell: scenario.featuredCell });
  }

  function playEffect(...[kind, params]: EffectCall) {
    startPlayback(read(kind, params));
  }

  function playDemo(kind: EffectKind, options: DemoOptions = {}) {
    let params = scenario.demo[kind];
    if (kind === 'REROLL_THROW') params = { gem: scenario.turn.rerollResults[options.reroll ?? 'available'] };
    if (kind === 'TURN_CHANGE' && options.otherTurn) params = { playerName: scenario.turn.nextPlayer.name, isLocal: false };
    if (kind === 'LOSS_NOTICE' && options.noPayment) params = { ...scenario.demo.LOSS_NOTICE, paidPoints: 0 };
    startPlayback(read(kind, params));
  }

  const actions: EffectsRuntime['actions'] = {
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

  return { player, audio, scenario, playDemo, actions };
}
