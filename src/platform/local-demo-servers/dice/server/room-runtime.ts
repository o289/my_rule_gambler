import { randomBytes, randomUUID } from 'node:crypto';
import { PhysicsRoll } from '../../../../features/dice/server/physics';
import type { RoomRuntime } from '../../../server/core/ports';
import { RollRunner } from './roll-runner';

export function createNodeRoomRuntime(options: { allowPreviewDev: boolean }): RoomRuntime {
  return {
    now: () => Date.now(),
    createPlayerId: () => randomUUID(),
    createToken: () => randomBytes(24).toString('base64url'),
    createBoardSeed: () => randomBytes(4).readUInt32LE(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    allowPreviewDev: options.allowPreviewDev,
    createRoll(input, callbacks) {
      const physics = new PhysicsRoll({ rollId: input.rollId, kind: input.kind, ids: input.ids, hz: input.config.hz });
      const runner = new RollRunner(physics, input.config.hz, input.config.count, {
        frame: callbacks.frame,
        metrics: callbacks.metrics,
        finished: frame => callbacks.finished(frame, physics.results, physics.nudgeCount, physics.deadline),
      });
      return { initialFrame: physics.frame(), start: () => runner.start(), stop: () => runner.stop() };
    },
  };
}
