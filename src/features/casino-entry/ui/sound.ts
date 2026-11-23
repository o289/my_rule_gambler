import { createAudioContext, CueAudio } from '../../../shared/audio/cue-audio';
type Source = OscillatorNode | AudioBufferSourceNode;
const QUIET = .0001;

export class EntranceSound {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private voices = new Map<Source, readonly AudioNode[]>();
  private readonly gate = new CueAudio(() => this.initialize());
  readonly unlock = this.gate.unlock;

  private initialize() {
    const context = createAudioContext();
    if (!context) return null;
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 1;
    master.connect(compressor).connect(context.destination);
    const noise = context.createBuffer(1, Math.floor(context.sampleRate * .24), context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    this.context = context;
    this.master = master;
    this.noise = noise;
    return context;
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

  playDoor() {
    this.gate.play(time => {
      const at = time + .008;
      this.tap(at, 158, .23, .14);
      this.tone(at + .12, 78, 48, .15, .70);
      this.tap(at + .22, 92, .105, .20);
      this.tap(at + .66, 136, .11, .19);
    });
  }

  playLatch() {
    this.gate.play(time => {
      this.tap(time + .012, 322, .12, .095);
      this.tap(time + .146, 488, .09, .082);
    });
  }

  playClose() {
    this.gate.play(time => {
      this.tone(time + .07, 57, 84, .075, .55);
      this.tap(time + .82, 118, .22, .172);
      this.tap(time + 1, 320, .084, .073);
    });
  }

  cut() {
    this.gate.cancel();
    for (const [node, graph] of this.voices) {
      node.stop();
      graph.forEach(item => item.disconnect());
    }
    this.voices.clear();
  }
}
