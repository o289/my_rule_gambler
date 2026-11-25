import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion as Rotation, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { DIE_BEVEL, DIE_SIZE, TRAY, upperFace } from '../../features/dice/model/geometry';
import type { GemId, Quaternion } from '../../features/dice/model/geometry';
import type { DiePose } from '../../shared/contracts/dice';
import { PhysicsRoll, initPhysics, nudgeCocked } from '../../features/dice/server/physics';

await initPhysics();

function randomFrom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

const faceAxes: readonly [GemId, Vector3][] = [
  ['ruby', new Vector3(0, 0, -1)], ['sapphire', new Vector3(1, 0, 0)],
  ['emerald', new Vector3(0, 1, 0)], ['amethyst', new Vector3(0, -1, 0)],
  ['topaz', new Vector3(-1, 0, 0)], ['diamond', new Vector3(0, 0, 1)],
];

function visuallyHighest(q: Quaternion) {
  const rotation = new Rotation(...q);
  return faceAxes.map(([gem, axis]) => ({ gem, up: axis.clone().applyQuaternion(rotation).y }))
    .sort((a, b) => b.up - a.up)[0];
}

function contained(die: DiePose) {
  const quaternion = new Rotation(...die.q);
  const radii = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
    .map(axis => axis.applyQuaternion(quaternion));
  const radius = (axis: 'x' | 'y' | 'z') => radii.reduce((sum, vector) => sum + Math.abs(vector[axis]) * (DIE_SIZE / 2 - DIE_BEVEL), DIE_BEVEL);
  assert.ok(die.p[1] - radius('y') >= -.075, `floor: ${JSON.stringify(die)}`);
  assert.ok(Math.abs(die.p[0]) <= TRAY.width / 2 + .01, `escaped wall X: ${JSON.stringify(die)}`);
  assert.ok(Math.abs(die.p[2]) <= TRAY.depth / 2 + .01, `escaped wall Z: ${JSON.stringify(die)}`);
  // A corner can project beyond a wall while it is above its top. Projection
  // on the horizontal axes is conservative when the whole die is below the rim.
  if (die.stopped || die.p[1] + radius('y') < TRAY.wallHeight) {
    assert.ok(Math.abs(die.p[0]) + radius('x') <= TRAY.width / 2 + .09, `wall X: ${JSON.stringify(die)}`);
    assert.ok(Math.abs(die.p[2]) + radius('z') <= TRAY.depth / 2 + .09, `wall Z: ${JSON.stringify(die)}`);
  }
}

test('どちらの更新頻度でも1〜5個のダイスがトレイ内で止まり、上面と出目が一致する', () => {
  let dieContact = false;
  let wallContact = false;
  for (const hz of [120, 240] as const) {
    for (const count of [1, 2, 3, 4, 5]) {
      for (const seed of [15, 351, 7137]) {
        const ids = Array.from({ length: count }, (_, index) => `die-${index + 1}`);
        const roll = new PhysicsRoll({ rollId: 'physical-test', kind: 'initial', ids, hz, random: randomFrom(seed + count) });
        try {
          for (let index = 0; index < hz * 8 && !roll.settled; index += 1) {
            roll.step();
            if (index % (hz / 60) !== 0) continue;
            const frame = roll.frame();
            for (const die of frame.dice) contained(die);
            dieContact ||= frame.hits.some(hit => hit.kind === 'dice');
            wallContact ||= frame.hits.some(hit => hit.kind === 'wall');
          }
          const final = roll.frame();
          assert.equal(final.phase, 'settled');
          assert.equal(final.dice.length, count);
          assert.deepEqual(roll.results.map(result => result.id), ids);
          assert.ok(final.dice.every(die => die.stopped));
          assert.ok(final.simMs < 6800);
          for (const [index, die] of final.dice.entries()) {
            contained(die);
            assert.equal(roll.results[index]?.gem, visuallyHighest(die.q)?.gem);
          }
          assert.deepEqual(roll.frame().dice, final.dice);
        } finally {
          roll.dispose();
        }
      }
    }
  }
  assert.ok(dieContact, 'Rapier reported at least one die-to-die shot');
  assert.ok(wallContact, 'Rapier reported at least one wall impact');
});

test('斜めに止まったダイスに上限付きの力を加え、物理演算が進むまで現在の姿勢を保つ', () => {
  const diagonal: Quaternion = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
  const q = { x: diagonal[0], y: diagonal[1], z: diagonal[2], w: diagonal[3] };
  const world = new RAPIER.World({ x: 0, y: -19.8, z: 0 });
  try {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(q).setTranslation(0, 1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(.5, .5, .5), body);
    const pose = body.translation();
    const actual = body.rotation();
    assert.equal(upperFace(diagonal).ambiguous, true);
    assert.equal(upperFace(diagonal).alignment, visuallyHighest(diagonal)?.up);
    assert.equal(nudgeCocked(body, diagonal, 2, () => .8), false);
    assert.equal(nudgeCocked(body, [0, 0, 0, 1], 0, () => .8), false);
    assert.equal(nudgeCocked(body, diagonal, 0, () => .8), true);
    assert.ok(body.linvel().y > .25);
    assert.deepEqual(body.translation(), pose);
    assert.deepEqual(body.rotation(), actual);
    world.step();
    assert.notDeepEqual(body.translation(), pose);
  } finally { world.free(); }
});
