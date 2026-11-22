import { beatsFor, effectDuration } from '../model/effect-model';
import type { Cue, EffectRequest } from '../model/effect-model';

export interface EffectPlayback {
  readonly id: number;
  readonly request: EffectRequest;
  readonly duration: number;
  readonly phase: Cue;
  readonly cues: ReadonlySet<Cue>;
  readonly playing: boolean;
  readonly skipped: boolean;
  readonly reduced: boolean;
}

export interface EffectAudio {
  cut(): void;
  playCue(effect: EffectRequest['kind'], cue: Cue, reduced: boolean): void;
}

interface Clock {
  now(): number;
  schedule(callback: () => void, delay: number): number;
  cancel(timer: number): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: timer => window.clearTimeout(timer),
};

export class EffectPlayer {
  private listeners = new Set<() => void>();
  private timers = new Set<number>();
  private sequence = 0;
  private playback: EffectPlayback | null = null;

  constructor(private audio: EffectAudio, private clock = browserClock) {}

  getSnapshot = () => this.playback;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(playback: EffectPlayback | null) {
    this.playback = playback;
    for (const notify of this.listeners) notify();
  }

  private stopPending() {
    for (const timer of this.timers) this.clock.cancel(timer);
    this.timers.clear();
    this.audio.cut();
  }

  play(request: EffectRequest, reduced: boolean) {
    this.stopPending();
    const id = ++this.sequence;
    const beats = beatsFor(request.kind, reduced);
    const started = this.clock.now();
    const duration = effectDuration(beats);
    const launch: EffectPlayback = {
      id, request, duration, phase: 'start',
      cues: new Set(['start']), playing: true, skipped: false, reduced,
    };
    this.publish(launch);
    for (const { at, cue } of beats) {
      if (this.playback?.id !== id || !this.playback.playing) break;
      const trigger = () => {
        const current = this.playback;
        if (!current?.playing || current.id !== id) return;
        if (cue !== 'start') {
          this.publish({ ...current, phase: cue, cues: new Set([...current.cues, cue]), playing: cue !== 'finish' });
        }
        if (this.playback?.id === id && !this.playback.skipped) this.audio.playCue(request.kind, cue, reduced);
      };
      if (at === 0) trigger();
      else {
        const timer = this.clock.schedule(() => {
          this.timers.delete(timer);
          trigger();
        }, Math.max(0, started + at - this.clock.now()));
        this.timers.add(timer);
      }
    }
  }

  skip() {
    const current = this.playback;
    if (!current?.playing) return;
    this.stopPending();
    this.publish({ ...current, phase: 'finish', playing: false, skipped: true });
  }

  reset() {
    this.stopPending();
    this.publish(null);
  }

  replay(reduced: boolean) {
    if (this.playback) this.play(this.playback.request, reduced);
  }
}

export function reached(playback: EffectPlayback, cue: Cue) {
  return playback.skipped || playback.cues.has(cue);
}
