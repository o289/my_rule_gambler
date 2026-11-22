interface AudioClock {
  readonly state: AudioContextState;
  readonly currentTime: number;
  resume(): Promise<void>;
}

interface PendingCue {
  readonly play: (time: number) => void;
  readonly expiresAt: number;
}

const MAX_CUE_DELAY_MS = 420;
const MAX_PENDING_CUES = 12;

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext }
}

export function createAudioContext() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  return Context ? new Context() : null;
}

export class CueAudio {
  private context: AudioClock | null = null;
  private resumeAttempt: number | null = null;
  private pending: PendingCue[] = [];

  constructor(
    private initialize: () => AudioClock | null,
    private now = () => performance.now(),
  ) {}

  unlock = () => {
    if (this.context?.state === 'running') return;
    const now = this.now();
    if (this.resumeAttempt !== null && now - this.resumeAttempt < MAX_CUE_DELAY_MS) return;
    try {
      const context = this.context?.state === 'closed' ? this.initialize() : this.context ?? this.initialize();
      this.context = context;
      if (!context || context.state === 'running') return;

      this.resumeAttempt = now;
      void context.resume().then(() => this.completeResume(now), () => this.completeResume(now));
    } catch {
      this.completeResume(now);
    }
  };

  private completeResume(attempt: number) {
    if (this.resumeAttempt !== attempt) return;
    this.resumeAttempt = null;
    const pending = this.pending;
    this.pending = [];
    const now = this.now();
    for (const cue of pending) {
      if (cue.expiresAt >= now) this.play(cue.play);
    }
  }

  play(cue: PendingCue['play']) {
    const context = this.context;
    if (this.resumeAttempt !== null && this.now() - this.resumeAttempt < MAX_CUE_DELAY_MS) {
      if (this.pending.length === MAX_PENDING_CUES) this.pending.shift();
      this.pending.push({ play: cue, expiresAt: this.now() + MAX_CUE_DELAY_MS });
      return;
    }
    if (context?.state !== 'running') return;
    try { cue(context.currentTime); }
    catch { return; }
  }

  cancel() { this.pending = []; }
}
