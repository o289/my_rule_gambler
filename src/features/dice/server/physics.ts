import type RAPIER from '@dimforge/rapier3d-compat';
import type { RigidBody, World, EventQueue } from '@dimforge/rapier3d-compat';
import { DIE_BEVEL, DIE_SIZE, TRAY, releaseAt, upperFace } from '../model/geometry';
import type { Quaternion, Vec3 } from '../model/geometry';
import type { DiceHz, DiceResult, DiePose, Frame, Impact, RollKind } from '../../../shared/contracts/dice';

export type PhysicsRuntime = typeof RAPIER;
let ready: Promise<void> | undefined;
let rapierApi: PhysicsRuntime | undefined;

export async function initPhysics() {
  const runtime = (await import('@dimforge/rapier3d-compat')).default;
  if (rapierApi && rapierApi !== runtime) throw new Error('Physics is already initialized with a different Rapier API');
  rapierApi = runtime;
  ready ??= runtime.init();
  return ready;
}

function requireRapier() {
  if (!rapierApi) throw new Error('Call initPhysics before creating a roll');
  return rapierApi;
}

const THROW_SPACING = 46;
const STOP_SECONDS = .25;
const MAX_NUDGES = 2;
const MAX_PHYSICS_MS = 5700;

interface DiceBody {
  readonly id: string;
  readonly body: RigidBody;
  quiet: number;
  nudges: number;
}

export interface StartPose {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly velocity: Vec3;
  readonly spin: Vec3;
}

interface Options {
  readonly rollId: string;
  readonly kind: RollKind;
  readonly ids: readonly string[];
  readonly hz: DiceHz;
  readonly random?: () => number;
  readonly startPose?: (index: number) => StartPose;
}

function components([x, y, z]: Vec3) { return { x, y, z }; }
function rotation(body: RigidBody): Quaternion {
  const value = body.rotation();
  return [value.x, value.y, value.z, value.w];
}

function throwPose(index: number, count: number, random: () => number): StartPose {
  const inRange = (min: number, max: number) => min + (max - min) * random();
  const u = random();
  const v = random() * Math.PI * 2;
  const w = random() * Math.PI * 2;
  const lateral = (index - (count - 1) / 2) * (count < 4 ? .79 : .875);
  const spin = () => inRange(6, 14) * (random() >= .5 ? 1 : -1);
  return {
    position: [inRange(3.04, 3.37) + .24 * (index % 2), inRange(1.68, 2.04), lateral + inRange(-.15, .15)],
    rotation: [
      Math.sqrt(1 - u) * Math.sin(v),
      Math.sqrt(1 - u) * Math.cos(v),
      Math.sqrt(u) * Math.sin(w),
      Math.sqrt(u) * Math.cos(w),
    ],
    velocity: [inRange(-10.3, -6.75), inRange(-2.25, -.95), inRange(-2.4, 2.4)],
    spin: [spin(), spin() * .74, spin()],
  };
}

export function nudgeCocked(body: RigidBody, quaternion: Quaternion, attempts: number, random: () => number) {
  if (attempts >= MAX_NUDGES || !upperFace(quaternion).ambiguous) return false;
  const { x, z } = body.translation();
  const sign = random() < .5 ? -1 : 1;
  body.applyImpulse({ x: x > 0 ? -.21 : .21, y: .34, z: z > 0 ? -.16 : .16 }, true);
  body.applyTorqueImpulse({ x: .21 * sign, y: -.11, z: .26 * -sign }, true);
  return true;
}

export class PhysicsRoll {
  readonly dt: number;
  readonly releaseMs: number;
  private world: World;
  private events: EventQueue;
  private dice: DiceBody[] = [];
  private surface = new Map<number, 'floor' | 'wall'>();
  private hits: Impact[] = [];
  private stepIndex = 0;
  private sequence = 0;
  private disposed = false;
  private readonly rapier: PhysicsRuntime;
  private readonly random: () => number;
  private finished: readonly DiceResult[] = [];
  private hitDeadline = false;
  private nudges = 0;

  constructor(private readonly options: Options, rapier: PhysicsRuntime = requireRapier()) {
    this.rapier = rapier;
    this.dt = 1 / options.hz;
    this.releaseMs = releaseAt(options.kind);
    this.random = options.random ?? Math.random;
    this.world = new this.rapier.World({ x: 0, y: -19.8, z: 0 });
    this.world.timestep = this.dt;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 4;
    this.events = new this.rapier.EventQueue(true);
    const { width, depth, floor, wall, wallHeight } = TRAY;
    this.createSurface([width, floor, depth], [0, -floor / 2, 0], 'floor');
    for (const sign of [-1, 1]) {
      this.createSurface([width + 2 * wall, wallHeight, wall], [0, wallHeight / 2, sign * (depth + wall) / 2], 'wall');
      this.createSurface([wall, wallHeight, depth], [sign * (width + wall) / 2, wallHeight / 2, 0], 'wall');
    }
  }

  get simMs() { return this.stepIndex * this.dt * 1000; }
  get steps() { return this.stepIndex; }
  get results() { return this.finished; }
  get deadline() { return this.hitDeadline; }
  get nudgeCount() { return this.nudges; }
  get settled() { return this.finished.length > 0; }

  private createSurface([width, height, depth]: Vec3, [x, y, z]: Vec3, kind: 'floor' | 'wall') {
    const collider = this.world.createCollider(this.rapier.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setTranslation(x, y, z)
      .setFriction(kind === 'floor' ? .59 : .48)
      .setRestitution(kind === 'floor' ? .20 : .28));
    this.surface.set(collider.handle, kind);
  }

  private spawn(id: string, index: number) {
    const initial = this.options.startPose?.(index) ?? throwPose(index, this.options.ids.length, this.random);
    const [x, y, z, w] = initial.rotation;
    const [px, py, pz] = initial.position;
    const [vx, vy, vz] = initial.velocity;
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(px, py, pz).setRotation({ x, y, z, w })
      .setLinvel(vx, vy, vz).setAngvel(components(initial.spin))
      .setLinearDamping(.48).setAngularDamping(.46)
      .setCanSleep(true).setCcdEnabled(true));
    const inner = DIE_SIZE / 2 - DIE_BEVEL;
    this.world.createCollider(this.rapier.ColliderDesc.roundCuboid(inner, inner, inner, DIE_BEVEL)
      .setDensity(1.06).setFriction(.54).setRestitution(.23)
      .setActiveEvents(this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(23), body);
    this.dice.push({ id, body, quiet: 0, nudges: 0 });
  }

  private impacts() {
    this.events.drainContactForceEvents(event => {
      const impulse = event.totalForceMagnitude() * this.dt;
      if (impulse < .28) return;
      const kind = this.surface.get(event.collider1()) ?? this.surface.get(event.collider2()) ?? 'dice';
      this.hits.push({ kind, strength: Math.min(1, impulse / 5.4) });
    });
    this.hits.sort((left, right) => right.strength - left.strength);
    this.hits.length = Math.min(this.hits.length, 5);
  }

  step() {
    if (this.disposed || this.settled) return;
    this.stepIndex += 1;
    for (;;) {
      const index = this.dice.length;
      const id = this.options.ids[index];
      if (!id || this.simMs < this.releaseMs + index * THROW_SPACING) break;
      this.spawn(id, index);
    }
    this.world.step(this.events);
    this.impacts();

    for (const die of this.dice) {
      const linear = die.body.linvel();
      const angular = die.body.angvel();
      const slow = die.body.isSleeping()
        || (Math.hypot(linear.x, linear.y, linear.z) < .095 && Math.hypot(angular.x, angular.y, angular.z) < .24);
      die.quiet = slow ? die.quiet + this.dt : 0;
    }
    if (this.dice.length !== this.options.ids.length) return;
    const allStopped = this.dice.every(die => die.quiet >= STOP_SECONDS);
    const timeLimit = this.simMs >= this.releaseMs + MAX_PHYSICS_MS;
    if (!allStopped && !timeLimit) return;
    this.hitDeadline = timeLimit;

    if (allStopped && !timeLimit) {
      let nudged = false;
      for (const die of this.dice) {
        if (!nudgeCocked(die.body, rotation(die.body), die.nudges, this.random)) continue;
        die.nudges += 1;
        this.nudges += 1;
        die.quiet = 0;
        nudged = true;
      }
      if (nudged) return;
    }

    this.finished = this.dice.map(die => {
      const face = upperFace(rotation(die.body));
      return { id: die.id, gem: face.gem, approximate: face.ambiguous };
    });
    for (const die of this.dice) die.body.sleep();
  }

  frame(): Frame {
    const phase = this.settled ? 'settled'
      : this.simMs >= this.releaseMs ? 'rolling'
      : this.options.kind === 'reroll' && this.simMs < 970 ? 'collection' : 'cup';
    const dice: DiePose[] = this.dice.map(die => {
      const { x, y, z } = die.body.translation();
      return { id: die.id, p: [x, y, z], q: rotation(die.body), stopped: this.settled || die.quiet >= STOP_SECONDS };
    });
    const hits = this.hits;
    this.hits = [];
    return { rollId: this.options.rollId, seq: this.sequence++, simMs: this.simMs, phase, dice, hits };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.events.free();
    this.world.free();
  }
}
