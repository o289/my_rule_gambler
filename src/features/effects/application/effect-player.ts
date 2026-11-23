import { beatsFor, effectDuration } from '../model/effect-model';
import type { Beat, Cue, EffectRequest, EffectScenario } from '../model/effect-model';

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

interface RollContinuation {
  id: number;
  started: number;
  beats: readonly Beat[];
  fallback: number;
}

const browserClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: timer => window.clearTimeout(timer),
};

const SETTLE_GRACE_MS = 300;
const REDUCED_SETTLE_GRACE_MS = 85;

export class EffectPlayer {
  private listeners = new Set<() => void>();
  private timers = new Set<number>();
  private sequence = 0;
  private playback: EffectPlayback | null = null;
  private continuation: RollContinuation | null = null;
  private requests: readonly EffectRequest[] = [];
  private nextIndex = 0;

  constructor(private audio: EffectAudio, private scenario: Pick<EffectScenario, 'board' | 'turn'>, private clock = browserClock) {}

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
    this.continuation = null;
    this.audio.cut();
  }

  private schedule(at: number, callback: () => void) {
    const timer = this.clock.schedule(() => {
      this.timers.delete(timer);
      callback();
    }, Math.max(0, at - this.clock.now()));
    this.timers.add(timer);
    return timer;
  }

  private scheduleBeats(id: number, beats: readonly Beat[], started: number, offset = 0) {
    for (const { at, cue } of beats) {
      if (!this.playback?.playing || this.playback.id !== id) break;
      const trigger = () => {
        const current = this.playback;
        if (!current?.playing || current.id !== id) return;
        if (cue !== 'start') {
          this.publish({ ...current, phase: cue, cues: new Set([...current.cues, cue]), playing: cue !== 'finish' });
        }
        if (this.playback?.id !== id || this.playback.skipped) return;
        const kind = current.request.kind === 'ONE_CELL_COMEBACK' && current.cues.has('comeback')
          ? 'COMEBACK' : current.request.kind;
        this.audio.playCue(kind, cue, current.reduced);
        if (cue === 'finish') this.playNext(current.reduced);
      };
      if (at === offset) trigger();
      else this.schedule(started + at - offset, trigger);
    }
  }

  play(request: EffectRequest, reduced: boolean) {
    this.playAll([request], reduced);
  }

  playAll(requests: readonly EffectRequest[], reduced: boolean) {
    if (!requests.length) {
      this.reset();
      return;
    }
    this.requests = requests;
    this.nextIndex = 0;
    this.playNext(reduced);
  }

  private playNext(reduced: boolean) {
    const request = this.requests[this.nextIndex];
    if (!request) return;
    this.nextIndex += 1;
    this.stopPending();
    const id = ++this.sequence;
    const beats = beatsFor(request, reduced, this.scenario);
    const started = this.clock.now();
    this.publish({
      id, request, duration: effectDuration(beats), phase: 'start',
      cues: new Set(['start']), playing: true, skipped: false, reduced,
    });
    if (!this.playback?.playing || this.playback.id !== id) return;

    const stop = beats.findIndex(beat => beat.cue === 'roll-stop');
    const landing = beats[stop];
    if (!landing) {
      this.scheduleBeats(id, beats, started);
      return;
    }

    const grace = reduced ? REDUCED_SETTLE_GRACE_MS : SETTLE_GRACE_MS;
    this.continuation = {
      id, started, beats: beats.slice(stop),
      fallback: this.schedule(started + landing.at + grace, () => this.settleRoll(id)),
    };
    this.scheduleBeats(id, beats.slice(0, stop), started);
  }

  settleRoll(id: number) {
    const continuation = this.continuation;
    const current = this.playback;
    if (continuation?.id !== id || current?.id !== id || current.phase !== 'roll' || !current.playing) return;
    this.continuation = null;
    this.clock.cancel(continuation.fallback);
    this.timers.delete(continuation.fallback);
    const now = this.clock.now();
    const nominal = continuation.beats[0]?.at ?? 0;
    this.publish({ ...current, duration: now - continuation.started + effectDuration(continuation.beats) - nominal });
    this.scheduleBeats(id, continuation.beats, now, nominal);
  }

  skip() {
    const current = this.playback;
    if (!current?.playing) return;
    this.stopPending();
    this.publish({ ...current, phase: 'finish', playing: false, skipped: true });
    if (this.playback?.id === current.id) this.playNext(current.reduced);
  }

  reset() {
    this.stopPending();
    this.requests = [];
    this.nextIndex = 0;
    this.publish(null);
  }

  replay(reduced: boolean) {
    if (this.playback) this.playAll(this.requests, reduced);
  }
}

export function reached(playback: EffectPlayback, cue: Cue) {
  return playback.skipped || playback.cues.has(cue);
}
