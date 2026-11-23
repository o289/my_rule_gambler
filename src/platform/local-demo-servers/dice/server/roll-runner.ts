import { CAPTURE_HZ } from '../../../../features/dice/model/geometry';
import type { Frame, Metrics } from '../../../../shared/contracts/dice';
import { PhysicsRoll } from '../../../../features/dice/server/physics';
import { advanceRoll } from '../../../server/core/dice/roll-engine';

interface RollEvents {
  frame(frame: Frame): boolean;
  metrics(metrics: Metrics): void;
  finished(frame: Frame): void;
}

export class RollRunner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private accumulator = 0;
  private lastTick = 0;
  private startedAt = 0;
  private measuredAt = 0;
  private cpu = process.cpuUsage();
  private stepCount = 0;
  private sent = 0;
  private sum = 0;
  private peak = 0;
  private lastReport: Metrics | null = null;

  constructor(private physics: PhysicsRoll, private hz: 120 | 240, private count: number, private callbacks: RollEvents) {}

  start() {
    this.lastTick = performance.now();
    this.measuredAt = this.startedAt = this.lastTick;
    this.timer = setInterval(() => this.tick(), 4);
  }

  private sendMetrics(now: number, stoppedMs: number | null) {
    const elapsed = now - this.measuredAt;
    const usage = process.cpuUsage(this.cpu);
    const report: Metrics = {
      hz: this.hz, count: this.count,
      stepsPerSecond: elapsed >= 100 ? this.stepCount * 1000 / elapsed : null,
      sentPerSecond: elapsed >= 100 ? this.sent * 1000 / elapsed : null,
      meanStepMs: this.stepCount ? this.sum / this.stepCount : null,
      peakStepMs: this.stepCount ? this.peak : null,
      cpuPercent: elapsed >= 100 ? (usage.user + usage.system) / elapsed / 10 : null,
      stoppedMs,
    };
    if (elapsed >= 100) this.lastReport = report;
    this.callbacks.metrics(elapsed < 100 && this.lastReport ? { ...this.lastReport, stoppedMs } : report);
    this.cpu = process.cpuUsage();
    this.measuredAt = now;
    this.stepCount = this.sent = this.sum = this.peak = 0;
  }

  private tick() {
    const now = performance.now();
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    const advance = advanceRoll(this.physics, this.accumulator, elapsed, this.hz, CAPTURE_HZ, step => {
      const start = performance.now();
      step();
      const stepMs = performance.now() - start;
      this.stepCount += 1;
      this.sum += stepMs;
      this.peak = Math.max(this.peak, stepMs);
    });
    this.accumulator = advance.accumulatorMs;
    for (const frame of advance.frames) {
      if (this.callbacks.frame(frame)) this.sent += 1;
    }

    if (advance.finalFrame) {
      if (this.callbacks.frame(advance.finalFrame)) this.sent += 1;
      const stopped = performance.now();
      this.sendMetrics(stopped, stopped - this.startedAt);
      this.callbacks.finished(advance.finalFrame);
      this.stop();
      return;
    }
    if (now - this.measuredAt >= 800) this.sendMetrics(now, null);
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.physics.dispose();
  }
}
