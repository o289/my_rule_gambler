import type { RoomRuntime } from '../server/core/ports';
import type { RollSession, RollSessionCallbacks } from '../server/core/ports';
import type { RollConfig, RollKind, Frame } from '../../shared/contracts/dice';
import { CAPTURE_HZ } from '../../features/dice/model/geometry';
import { PhysicsRoll } from '../../features/dice/server/physics';
import type { PhysicsRuntime } from '../../features/dice/server/physics';
import { advanceRoll } from '../server/core/dice/roll-engine';

type CreateRollInput = { rollId: string; kind: RollKind; ids: readonly string[]; config: RollConfig };

export interface CloudflareRoomRuntimeOptions {
  readonly loadPhysicsRuntime?: () => PhysicsRuntime;
  readonly schedule?: RoomRuntime['schedule'];
  readonly cancelTimer?: RoomRuntime['cancelTimer'];
}

class CloudflareRollSession implements RollSession {
  readonly initialFrame: Frame;
  private timer: ReturnType<typeof setInterval> | undefined;
  private accumulatorMs = 0;
  private lastTick = 0;
  private stopped = false;

  constructor(
    private readonly physics: PhysicsRoll,
    private readonly input: CreateRollInput,
    private readonly callbacks: RollSessionCallbacks,
  ) {
    this.initialFrame = physics.frame();
  }

  start() {
    if (this.timer !== undefined || this.stopped) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 4);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.physics.dispose();
  }

  private tick() {
    if (this.stopped) return;
    const now = Date.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    const advance = advanceRoll(this.physics, this.accumulatorMs, elapsed, this.input.config.hz, CAPTURE_HZ);
    this.accumulatorMs = advance.accumulatorMs;
    for (const frame of advance.frames) this.callbacks.frame(frame);

    if (advance.finalFrame) {
      try {
        this.callbacks.frame(advance.finalFrame);
        this.callbacks.finished(advance.finalFrame, this.physics.results, this.physics.nudgeCount, this.physics.deadline);
      } finally {
        this.stop();
      }
    }
  }
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createBoardSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return new DataView(bytes.buffer).getUint32(0, true);
}

export function createCloudflareRoomRuntime(options: CloudflareRoomRuntimeOptions = {}): RoomRuntime {
  return {
    now: () => Date.now(),
    createPlayerId: () => crypto.randomUUID(),
    createToken,
    createBoardSeed,
    schedule: options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    cancelTimer: options.cancelTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)),
    createRoll(input, callbacks) {
      if (!options.loadPhysicsRuntime) throw new Error('Cloudflare Rapier runtime is not configured.');
      const physics = new PhysicsRoll({
        rollId: input.rollId, kind: input.kind, ids: [...input.ids], hz: input.config.hz,
      }, options.loadPhysicsRuntime());
      return new CloudflareRollSession(physics, input, callbacks);
    },
    allowPreviewDev: false,
  };
}
