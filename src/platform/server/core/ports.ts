import type { Frame, Metrics, RollConfig, RollKind, DiceResult } from '../../../shared/contracts/dice';

export type TimerHandle = unknown;

export interface RollSessionCallbacks {
  frame(frame: Frame): boolean;
  metrics(metrics: Metrics): void;
  finished(frame: Frame, results: readonly DiceResult[], nudges: number, deadline: boolean): void;
}

export interface RollSession {
  readonly initialFrame: Frame;
  start(): void;
  stop(): void;
}

export interface RoomRuntime {
  now(): number;
  createPlayerId(): string;
  createToken(): string;
  createBoardSeed(): number;
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancelTimer(timer: TimerHandle): void;
  createRoll(input: { rollId: string; kind: RollKind; ids: readonly string[]; config: RollConfig }, callbacks: RollSessionCallbacks): RollSession;
  readonly allowPreviewDev: boolean;
}
