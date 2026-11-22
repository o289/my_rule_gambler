import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameStream } from '../../features/dice/ui/connection';
import type { Frame } from '../../shared/contracts/dice';

function packet(rollId: string, seq: number, ms: number, phase: Frame['phase'] = 'rolling'): Frame {
  return { rollId, seq, simMs: ms, phase, dice: [], hits: [] };
}

test('the render clock only advances, late frames are ignored, and the final sample uses the exact server pose', () => {
  const buffer = new FrameStream();
  buffer.push(packet('one', 1, 100), 200);
  buffer.push(packet('one', 2, 116), 220);
  assert.equal(buffer.push(packet('one', 1, 100), 227), false);
  const first = buffer.sample('one', 273);
  assert.ok(first);
  assert.equal(first.time, 114);
  buffer.push(packet('one', 3, 132), 320);
  const late = buffer.sample('one', 320);
  assert.ok(late);
  assert.equal(late.time, first.time);
  const final = packet('one', 4, 150, 'settled');
  buffer.push(final, 324);
  assert.equal(buffer.sample('one', 324)?.a, final);
  assert.equal(buffer.sample('one', 324)?.b, final);
  buffer.push(packet('two', 0, 0), 355);
  assert.equal(buffer.sample('one', 355), null);
  assert.equal(buffer.sample('two', 355)?.time, 0);
});
