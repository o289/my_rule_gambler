export interface RollPhysics<TFrame> {
  readonly dt: number;
  readonly steps: number;
  readonly settled: boolean;
  step(): void;
  frame(): TFrame;
}

export interface RollAdvance<TFrame> {
  accumulatorMs: number;
  frames: TFrame[];
  finalFrame: TFrame | null;
}

/** Advances a physics roll by elapsed wall time while keeping fixed-step simulation deterministic. */
export function advanceRoll<TFrame>(
  physics: RollPhysics<TFrame>,
  accumulatorMs: number,
  elapsedMs: number,
  hz: number,
  captureHz: number,
  measureStep?: (step: () => void) => void,
): RollAdvance<TFrame> {
  let accumulator = Math.min(160, accumulatorMs + elapsedMs);
  const frames: TFrame[] = [];
  const stepMs = physics.dt * 1000;
  while (accumulator + 1e-8 >= stepMs) {
    accumulator -= stepMs;
    const step = () => physics.step();
    if (measureStep) measureStep(step);
    else step();

    if (physics.settled) return { accumulatorMs: accumulator, frames, finalFrame: physics.frame() };
    if (physics.steps % (hz / captureHz) === 0) frames.push(physics.frame());
  }
  return { accumulatorMs: accumulator, frames, finalFrame: null };
}
