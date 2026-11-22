import type { Impact } from '../../../shared/contracts/dice';

type Source = OscillatorNode | AudioBufferSourceNode;
const QUIET = .0001;

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext }
}

export class DiceSound {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private voices = new Map<Source, readonly AudioNode[]>();
  private enabled = false;
  private hitAt = -Infinity;

  async enable(next: boolean) {
    if (!next) {
      this.enabled = false;
      this.cut();
      return false;
    }
    if (navigator.userActivation?.isActive === false && this.context?.state !== 'running') return false;
    if (!this.context) {
      const Audio = window.AudioContext ?? window.webkitAudioContext;
      if (!Audio) return false;
      const context = new Audio();
      const master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      master.gain.value = .62;
      master.connect(compressor).connect(context.destination);
      const noise = context.createBuffer(1, Math.floor(context.sampleRate * .24), context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
      this.context = context;
      this.master = master;
      this.noise = noise;
    }
    if (this.context.state !== 'running') await this.context.resume();
    this.enabled = this.context.state === 'running';
    return this.enabled;
  }

  private start(source: Source, nodes: readonly AudioNode[], at: number, duration: number) {
    this.voices.set(source, nodes);
    source.addEventListener('ended', () => {
      if (this.voices.delete(source)) nodes.forEach(node => node.disconnect());
    }, { once: true });
    source.start(at);
    source.stop(at + duration + .009);
  }

  private envelope(ctx: AudioContext, at: number, volume: number, duration: number) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(QUIET, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .008);
    gain.gain.exponentialRampToValueAtTime(QUIET, at + duration);
    return gain;
  }

  private tone(at: number, frequency: number, target: number, volume: number, duration: number) {
    if (!this.context || !this.master || this.voices.size >= 10) return;
    const oscillator = this.context.createOscillator();
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(target, at + duration);
    const gain = this.envelope(this.context, at, volume, duration);
    oscillator.connect(gain).connect(this.master);
    this.start(oscillator, [oscillator, gain], at, duration);
  }

  private tap(at: number, frequency: number, volume: number, length: number) {
    if (!this.context || !this.master || !this.noise || this.voices.size >= 9) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency * 4.5;
    const gain = this.envelope(this.context, at, volume, length);
    source.connect(filter).connect(gain).connect(this.master);
    this.start(source, [source, filter, gain], at, length);
    this.tone(at, frequency, frequency * .54, volume * .43, length * .96);
  }

  impacts(list: readonly Impact[]) {
    if (!this.enabled || this.context?.state !== 'running') return;
    const hit = list[0];
    const at = this.context.currentTime + .055;
    if (!hit || hit.strength < .065 || at - this.hitAt < .047) return;
    this.hitAt = at;
    const frequency = hit.kind === 'floor' ? 174 : hit.kind === 'wall' ? 240 : 394;
    this.tap(at, frequency + hit.strength * 60, .05 + hit.strength * .33, .08 + hit.strength * .046);
  }

  cue(kind: 'cup' | 'result' | 'confirm') {
    if (!this.enabled || this.context?.state !== 'running') return;
    const at = this.context.currentTime + .008;
    if (kind === 'cup') this.tap(at, 228, .12, .093);
    if (kind === 'confirm') this.tap(at, 286, .135, .092);
    if (kind === 'result') {
      for (const [index, frequency] of [784, 1174.66, 1568].entries()) {
        this.tone(at + index * .047, frequency, frequency, .065 - index * .012, .42);
      }
    }
  }

  cut() {
    for (const [node, graph] of this.voices) {
      node.stop();
      graph.forEach(item => item.disconnect());
    }
    this.voices.clear();
  }
}
