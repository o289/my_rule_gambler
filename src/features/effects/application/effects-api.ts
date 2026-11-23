import { readEffect, settlementEffects } from '../model/effect-model';
import type { EffectCall, EffectKind, EffectScenario, ScoreSettlement } from '../model/effect-model';
import { EffectPlayer } from './effect-player';
import type { EffectAudio } from './effect-player';

export interface EffectsAudio extends EffectAudio {
  unlock(): void;
}

interface DemoOptions {
  otherTurn?: boolean;
}

export interface EffectsRuntime {
  player: EffectPlayer;
  audio: EffectsAudio;
  scenario: EffectScenario;
  playDemo: (kind: EffectKind, options?: DemoOptions) => void;
  actions: {
    playEffect: (...call: EffectCall) => void;
    playSettlement: (settlement: ScoreSettlement) => void;
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
  const player = new EffectPlayer(audio, scenario);

  function startPlayback(request: ReturnType<typeof readEffect>) {
    if (request.kind === 'ONE_CELL_COMEBACK') {
      void preloadDice().catch(() => undefined);
    }
    player.play(request, reducedMotion());
  }

  function read(kind: unknown, params: unknown) {
    return readEffect(kind, params, { board: scenario.board, featuredCell: scenario.featuredCell });
  }

  function playEffect(...[kind, params]: EffectCall) {
    startPlayback(read(kind, params));
  }

  function playDemo(kind: EffectKind, options: DemoOptions = {}) {
    let params = scenario.demo[kind];
    if (kind === 'TURN_CHANGE' && options.otherTurn) params = { playerName: scenario.turn.nextPlayer.name, isLocal: false };
    startPlayback(read(kind, params));
  }

  const actions: EffectsRuntime['actions'] = {
    playEffect,
    playSettlement: settlement => {
      const requests = settlementEffects(settlement).map(([kind, params]) => read(kind, params));
      player.playAll(requests, reducedMotion());
    },
    replay: () => player.replay(reducedMotion()),
    skip: () => player.skip(),
    reset: () => player.reset(),
  };

  return { player, audio, scenario, playDemo, actions };
}
