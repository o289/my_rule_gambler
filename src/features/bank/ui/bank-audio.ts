import type { BankBeat, BankDirection } from '../model/bank-model';
import type { BankAudioPort } from '../application/bank-player';

type VoiceSource = OscillatorNode | AudioBufferSourceNode;

interface Envelope {
  at: number;
  length: number;
  volume: number;
  attack?: number;
}

interface Tone extends Envelope {
  frequency: number;
  end?: number;
  shape?: OscillatorType;
}

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext; }
}

const FLOOR = .0001;

export class BankAudio implements BankAudioPort {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private playing = new Map<VoiceSource, readonly AudioNode[]>();
  private active = false;
  private volume = .64;
  private setting = 0;

  private connect() {
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) return null;
    const context = new Audio();
    const output = context.createGain();
    output.gain.value = this.volume;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -11;
    limiter.ratio.value = 4;
    output.connect(limiter).connect(context.destination);
    const noise = context.createBuffer(1, Math.ceil(context.sampleRate * .9), context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    this.context = context;
    this.output = output;
    this.noise = noise;
    return context;
  }

  async enable(active: boolean) {
    const setting = ++this.setting;
    if (!active) {
      this.active = false;
      this.cut();
      return false;
    }
    if (navigator.userActivation?.isActive === false && this.context?.state !== 'running') return this.active;
    const context = this.context ?? this.connect();
    if (!context) return false;
    if (context.state !== 'running') await context.resume();
    if (this.setting === setting) this.active = context.state === 'running';
    return this.active;
  }

  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.volume, this.context.currentTime, .02);
  }

  cut() {
    for (const [source, nodes] of this.playing) {
      source.stop();
      for (const node of nodes) node.disconnect();
    }
    this.playing.clear();
  }

  private voice(source: VoiceSource, nodes: readonly AudioNode[], at: number, length: number) {
    this.playing.set(source, nodes);
    source.addEventListener('ended', () => {
      if (!this.playing.delete(source)) return;
      for (const node of nodes) node.disconnect();
    }, { once: true });
    source.start(at);
    source.stop(at + length + .012);
  }

  private gain(context: AudioContext, { at, length, volume, attack = .013 }: Envelope) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(FLOOR, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(attack, length * .79));
    gain.gain.exponentialRampToValueAtTime(FLOOR, at + length);
    return gain;
  }

  private tone({ frequency, end, shape = 'sine', ...envelope }: Tone) {
    const context = this.context;
    if (!context || !this.output) return;
    const source = context.createOscillator();
    source.type = shape;
    source.frequency.setValueAtTime(frequency, envelope.at);
    if (end) source.frequency.exponentialRampToValueAtTime(end, envelope.at + envelope.length);
    const gain = this.gain(context, envelope);
    source.connect(gain).connect(this.output);
    this.voice(source, [source, gain], envelope.at, envelope.length);
  }

  private scrape(frequency: number, type: BiquadFilterType, envelope: Envelope) {
    const context = this.context;
    if (!context || !this.output || !this.noise) return;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, envelope.at);
    filter.frequency.exponentialRampToValueAtTime(frequency * .57, envelope.at + envelope.length);
    filter.Q.value = .85;
    const gain = this.gain(context, envelope);
    source.connect(filter).connect(gain).connect(this.output);
    this.voice(source, [source, filter, gain], envelope.at, envelope.length);
  }

  private lowWeight(at: number, length: number, volume: number) {
    this.tone({ at, length, volume, frequency: 117, end: 38 });
    this.scrape(535, 'lowpass', { at, length: length * .9, volume: volume * .7 });
  }

  private metalTap(at: number, volume: number, body = 860) {
    this.tone({ at, length: .165, frequency: body, end: body * .946, volume, shape: 'triangle' });
    this.tone({ at: at + .007, length: .235, frequency: body * 2.86, volume: volume * .43 });
    this.scrape(3650, 'bandpass', { at, length: .078, volume: volume * .69, attack: .006 });
  }

  cue(beat: BankBeat, reduced: boolean, direction: BankDirection) {
    if (!this.active || this.context?.state !== 'running') return;
    const at = this.context.currentTime + .007;
    const deposit = direction === 'deposit';
    switch (beat.cue) {
      case 'confirm':
        this.lowWeight(at, .32, deposit ? .15 : .22);
        this.metalTap(at + (reduced ? .04 : .115), .065, deposit ? 1040 : 770);
        break;
      case 'wake':
        this.tone({ at, length: reduced ? .19 : .43, frequency: 43, end: 75, volume: .16, attack: .09, shape: 'triangle' });
        this.scrape(510, 'bandpass', { at, length: .27, volume: .145, attack: .06 });
        break;
      case 'unlock':
        for (const [index, offset] of (reduced ? [0, .05] : [0, .084, .18, .295]).entries()) {
          this.metalTap(at + offset, .09 + index * .022, 400 + index * 73);
        }
        break;
      case 'open':
        this.lowWeight(at, reduced ? .22 : .62, .205);
        this.scrape(1160, 'bandpass', { at, length: reduced ? .19 : .59, volume: .13, attack: .082 });
        this.tone({ at: at + .04, length: reduced ? .22 : .54, frequency: 210, end: 111, volume: .086, shape: 'triangle', attack: .13 });
        break;
      case 'lift':
        this.metalTap(at, .073, 1370);
        this.tone({ at, length: .296, frequency: 411, end: deposit ? 1180 : 920, volume: .063, attack: .101 });
        break;
      case 'launch':
        if (!reduced) {
          const note = beat.index === 1 ? 778 : 685;
          this.scrape(1830, 'bandpass', { at, length: .34, volume: .075, attack: .067 });
          this.tone({ at: at + .08, length: .296, frequency: note, end: note * (deposit ? 1.46 : .45), volume: .045, attack: .06 });
        }
        break;
      case 'absorb': {
        if (deposit) {
          const note = beat.index === 0 ? 659.25 : 783.99;
          this.lowWeight(at, .14, .135);
          this.metalTap(at, .16, note * 1.8);
          this.tone({ at: at + .052, length: .22, frequency: note, volume: .096, shape: 'triangle' });
          this.tone({ at: at + .098, length: .255, frequency: note * 1.5, volume: .083 });
          break;
        }
        const base = Math.max(455, 690 - 72 * (beat.index ?? 0));
        this.lowWeight(at, .24, .235);
        this.metalTap(at, .205, base);
        this.metalTap(at + .047, .085, base * 1.55);
        this.tone({ at: at + .058, length: .27, frequency: 470, end: 292, volume: .084, shape: 'triangle' });
        break;
      }
      case 'close':
        this.lowWeight(at, reduced ? .225 : .56, .18);
        this.scrape(738, 'bandpass', { at, length: reduced ? .165 : .54, volume: .112, attack: .081 });
        break;
      case 'lock':
        this.lowWeight(at, .275, .245);
        this.metalTap(at, .18, 537);
        this.metalTap(at + .066, .075, 1130);
        break;
    }
  }
}
