import { createAudioContext, CueAudio } from '../../../shared/audio/cue-audio';
import { TUMBLE_DURATION } from '../../dice/model/die-motion';
import type { Cue, EffectKind } from '../model/effect-model';
import type { EffectAudio } from '../application/effect-player';

type Tone = {
  at: number;
  length: number;
  frequency: number;
  end?: number;
  gain: number;
  attack?: number;
  type?: OscillatorType;
};

interface Voice {
  source: OscillatorNode | AudioBufferSourceNode;
  nodes: AudioNode[];
}

const FLOOR = .0001;

export class SoundManager implements EffectAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Set<Voice>();
  private readonly gate = new CueAudio(() => this.initialize());
  readonly unlock = this.gate.unlock;

  private initialize() {
    const ctx = createAudioContext();
    if (!ctx) return null;
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 4;
    master.gain.value = 1;
    master.connect(compressor).connect(ctx.destination);
    const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.65), ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    this.context = ctx;
    this.master = master;
    this.noise = noise;
    return ctx;
  }

  cut() {
    this.gate.cancel();
    for (const voice of this.voices) {
      voice.source.stop();
      for (const node of voice.nodes) node.disconnect();
    }
    this.voices.clear();
  }

  private track(source: Voice['source'], nodes: AudioNode[]) {
    const voice = { source, nodes };
    this.voices.add(voice);
    source.addEventListener('ended', () => {
      if (!this.voices.delete(voice)) return;
      for (const node of nodes) node.disconnect();
    }, { once: true });
  }

  private tone({ at, length, frequency, end, gain, attack = .012, type = 'sine' }: Tone) {
    if (!this.context || !this.master) return;
    const source = this.context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, at);
    if (end) source.frequency.exponentialRampToValueAtTime(end, at + length);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(FLOOR, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + Math.min(attack, length * .8));
    envelope.gain.exponentialRampToValueAtTime(FLOOR, at + length);
    source.connect(envelope).connect(this.master);
    source.start(at);
    source.stop(at + length + .012);
    this.track(source, [source, envelope]);
  }

  private burst(at: number, length: number, gain: number, frequency: number, type: BiquadFilterType = 'lowpass', attack = .014) {
    if (!this.context || !this.master || !this.noise) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * .42), at + length);
    filter.Q.value = .8;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(FLOOR, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + Math.min(attack, length * .8));
    envelope.gain.exponentialRampToValueAtTime(FLOOR, at + length);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(at);
    source.stop(at + length + .012);
    this.track(source, [source, filter, envelope]);
  }

  private goldChime(at: number, gain = .09) {
    this.tone({ at, length: .48, frequency: 880, gain });
    this.tone({ at: at + .041, length: .55, frequency: 1479.98, gain: gain * .78 });
    this.tone({ at: at + .088, length: .57, frequency: 2217.46, gain: gain * .62 });
  }

  private weight(at: number, strength: number, length = .49) {
    this.tone({ at, length, frequency: 108, end: 33, gain: strength });
    this.tone({ at: at + .012, length: length * .66, frequency: 158, end: 49, gain: strength * .31, type: 'triangle' });
    this.burst(at, length * .79, strength * .86, 590);
  }

  private tension(at: number, length: number, strength: number) {
    this.tone({ at, length, frequency: 46, end: 94, gain: strength, attack: length * .66, type: 'triangle' });
    this.burst(at, length, strength * .62, 1340, 'bandpass', length * .72);
    for (let index = 0; index < 5; index += 1) {
      const offset = length * (1 - .69 ** index);
      this.tone({ at: at + offset, length: .28, frequency: 190 + 28 * index, gain: strength * (.27 + index * .075), type: 'triangle' });
    }
  }

  private fanfare(at: number, grand: boolean) {
    const phrases = grand
      ? [[0, 392], [.15, 523.25], [.29, 659.25], [.43, 783.99], [.66, 1046.5], [.91, 1174.66], [1.12, 1046.5]]
      : [[0, 440], [.14, 554.37], [.28, 659.25], [.45, 880]];
    for (const [offset = 0, frequency = 440] of phrases) {
      this.tone({ at: at + offset, length: .78, frequency, gain: grand ? .107 : .071, type: 'triangle', attack: .035 });
      this.tone({ at: at + offset + .025, length: .4, frequency: frequency * 2, gain: .028, attack: .015 });
    }
    for (const frequency of grand ? [130.81, 196, 261.63] : [146.83, 220, 293.66]) {
      this.tone({ at: at + .47, length: grand ? 1.61 : .85, frequency, gain: grand ? .1 : .063, type: 'triangle', attack: .16 });
    }
  }

  private rollSound(at: number) {
    for (const fraction of [.12, .25, .37, .49, .62]) {
      this.burst(at + fraction * TUMBLE_DURATION / 1000, .112, .14 - fraction * .11, 1040 - fraction * 620);
    }
  }

  playCue(effect: EffectKind, cue: Cue, reduced: boolean) {
    if (cue === 'silence') { this.cut(); return; }
    this.gate.play(time => this.synthesize(effect, cue, reduced, time + .008));
  }

  private synthesize(effect: EffectKind, cue: Cue, reduced: boolean, at: number) {

    switch (effect) {
      case 'TURN_CHANGE':
        if (cue === 'start') this.goldChime(at, .045);
        break;
      case 'LOSS_NOTICE':
        if (cue === 'place') this.weight(at, .19, .16);
        if (cue === 'charge') this.burst(at, .32, .16, 1160, 'bandpass');
        if (cue === 'flight') this.tone({ at, length: .56, frequency: 650, end: 296, gain: .04, attack: .14 });
        if (cue === 'reveal') {
          this.weight(at, .18, .17);
          this.tone({ at, frequency: 1040, end: 810, gain: .055, length: .22, type: 'triangle' });
        }
        break;
      case 'DICE_STOP':
        if (cue === 'start' && !reduced) this.rollSound(at);
        if (cue === 'impact') this.weight(at, .22, .26);
        if (cue === 'glow') this.goldChime(at, .056);
        break;
      case 'ONE_CELL_COMEBACK':
      case 'REROLL_THROW':
        if (cue === 'start' && effect === 'REROLL_THROW') {
          this.burst(at, .077, .15, 2600, 'bandpass', .006);
          this.tone({ at, frequency: 730, end: 443, gain: .11, length: .107, type: 'triangle' });
        }
        if (cue === 'roll' && !reduced) this.rollSound(at);
        if (cue === 'roll-stop') this.weight(at, .19, .19);
        if (cue === 'flight' && !reduced) this.tone({ at, length: .53, frequency: 310, end: 790, gain: .052, attack: .28 });
        if (cue === 'place') this.goldChime(at, .052);
        if (cue === 'handoff') this.goldChime(at, .045);
        break;
      case 'GEM_PLACEMENT':
        if (cue === 'flight') this.tone({ at, length: .53, frequency: 310, end: 790, gain: .052, attack: .28 });
        if (cue === 'impact') {
          this.weight(at, .14, .18);
          this.tone({ at, frequency: 1530, end: 1140, gain: .065, length: .17, type: 'triangle' });
        }
        if (cue === 'glow') this.goldChime(at, .041);
        break;
      case 'BIG_WIN':
        if (cue === 'gather') this.tension(at, .97, .17);
        if (cue === 'impact') {
          this.weight(at, .4, .71);
          this.burst(at, .8, .24, 4400, 'bandpass', .028);
          this.goldChime(at + .08);
          this.fanfare(at + .24, false);
        }
        break;
      case 'COMEBACK':
        if (cue === 'focus') this.tension(at, .46, .145);
        if (cue === 'impact') {
          this.weight(at, .35, .48);
          this.burst(at, .38, .205, 3090, 'highpass');
          this.tone({ at: at + .035, length: .41, frequency: 460, end: 288, gain: .11, type: 'triangle' });
        }
        if (cue === 'reveal') {
          this.tone({ at, length: .62, frequency: 293.66, gain: .13, type: 'triangle' });
          this.tone({ at: at + .11, length: .61, frequency: 587.33, gain: .082 });
          this.goldChime(at + .2, .055);
        }
        break;
      case 'JACKPOT_VICTORY':
        if (cue === 'start') this.goldChime(at, .035);
        if (cue === 'gather') this.tension(at, .94, .13);
        if (cue === 'charge') this.tension(at, 1.02, .23);
        if (cue === 'impact') {
          this.weight(at, .57, .85);
          this.burst(at, 1.01, .34, 5100, 'bandpass', .033);
          this.goldChime(at + .11, .097);
        }
        if (cue === 'reveal') this.fanfare(at + .035, true);
    }
  }
}
