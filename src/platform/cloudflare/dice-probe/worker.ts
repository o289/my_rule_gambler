import RAPIER from '@dimforge/rapier3d';
// Wrangler compiles this package asset into a WebAssembly.Module.
import rapierWasm from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm';
// @ts-expect-error The package does not declare the generated glue subpath.
import * as rapierGlue from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import { CAPTURE_HZ } from '../../../features/dice/model/geometry';
import { PhysicsRoll } from '../../../features/dice/server/physics';
import type { PhysicsRuntime } from '../../../features/dice/server/physics';
import { advanceRoll } from '../../server/core/dice/roll-engine';
import type { DiceResult, RollKind } from '../../../shared/contracts/dice';

interface ProbeEnvironment {
  DICE_PROBE_ROOMS: DurableObjectNamespace;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface DurableObjectState {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
  waitUntil(promise: Promise<unknown>): void;
}

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

interface RollCommand {
  readonly type: 'roll';
  readonly rollId: string;
  readonly kind: RollKind;
  readonly ids: readonly string[];
}

const rapierApi = RAPIER as unknown as PhysicsRuntime;
const glue = rapierGlue as unknown as { __wbg_set_wasm(exports: WebAssembly.Exports): void };
let rapierReady: Promise<void> | undefined;

function initializeRapier() {
  rapierReady ??= Promise.resolve().then(() => {
    const instance = new WebAssembly.Instance(rapierWasm, {
      './rapier_wasm3d_bg.js': rapierGlue,
    });
    glue.__wbg_set_wasm(instance.exports);
  });
  return rapierReady;
}

function isRollCommand(value: unknown): value is RollCommand {
  if (typeof value !== 'object' || value === null) return false;
  const command = value as Record<string, unknown>;
  return command.type === 'roll'
    && typeof command.rollId === 'string'
    && /^[a-zA-Z0-9_-]{1,64}$/.test(command.rollId)
    && (command.kind === 'initial' || command.kind === 'reroll')
    && Array.isArray(command.ids)
    && command.ids.length > 0
    && command.ids.length <= 5
    && command.ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id))
    && new Set(command.ids).size === command.ids.length;
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export default {
  async fetch(request: Request, env: ProbeEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/dice-probe') return new Response('Not found', { status: 404 });
    const roomName = url.searchParams.get('room');
    if (!roomName || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomName)) return new Response('Invalid room', { status: 400 });
    const id = env.DICE_PROBE_ROOMS.idFromName(roomName);
    return env.DICE_PROBE_ROOMS.get(id).fetch(request);
  },
};

/** Temporary probe transport. It is not used by the normal game routes. */
export class DiceProbeRoom {
  private activeRoll = false;
  private readonly completedRollIds = new Set<string>();

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    this.broadcast({ type: 'connected', clients: this.state.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 4096) {
      this.send(socket, { type: 'error', message: 'Expected a short JSON message.' });
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      this.send(socket, { type: 'error', message: 'Invalid JSON.' });
      return;
    }
    if (!isRollCommand(value)) {
      this.send(socket, { type: 'error', message: 'Invalid roll request.' });
      return;
    }
    if (this.activeRoll || this.completedRollIds.has(value.rollId)) {
      this.send(socket, { type: 'error', message: 'Roll is already active or completed.' });
      return;
    }

    this.activeRoll = true;
    this.completedRollIds.add(value.rollId);
    if (this.completedRollIds.size > 64) this.completedRollIds.delete(this.completedRollIds.values().next().value!);
    this.state.waitUntil(this.runRoll(value).catch(error => {
      this.broadcast({ type: 'error', rollId: value.rollId, message: error instanceof Error ? error.message : 'Roll failed.' });
    }).finally(() => {
      this.activeRoll = false;
    }));
  }

  webSocketClose(socket: WebSocket) {
    try { socket.close(); } catch { /* The connection may already be closed. */ }
  }

  webSocketError(socket: WebSocket) {
    try { socket.close(1011, 'socket error'); } catch { /* The connection may already be closed. */ }
  }

  private send(socket: WebSocket, message: unknown) {
    if (socket.readyState !== 1) return;
    try { socket.send(JSON.stringify(message)); } catch { /* A disconnected probe client is ignored. */ }
  }

  private broadcast(message: unknown) {
    const encoded = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      try { socket.send(encoded); } catch { /* A disconnected probe client is ignored. */ }
    }
  }

  private async runRoll(command: RollCommand) {
    await initializeRapier();
    const physics = new PhysicsRoll({ rollId: command.rollId, kind: command.kind, ids: command.ids, hz: 120 }, rapierApi);
    let accumulatorMs = 0;
    let lastTick = Date.now();
    const startedAt = lastTick;
    let frameCount = 0;
    this.broadcast({ type: 'started', clients: this.state.getWebSockets().length, rollId: command.rollId, kind: command.kind, hz: 120, diceCount: command.ids.length });

    try {
      while (!physics.settled) {
        await delay(4);
        const now = Date.now();
        const result = advanceRoll(physics, accumulatorMs, now - lastTick, 120, CAPTURE_HZ);
        accumulatorMs = result.accumulatorMs;
        lastTick = now;
        for (const frame of result.frames) {
          this.broadcast({ type: 'frame', frame });
          frameCount += 1;
        }
        if (result.finalFrame) {
          this.broadcast({ type: 'frame', frame: result.finalFrame });
          frameCount += 1;
          const results: readonly DiceResult[] = physics.results;
          this.broadcast({
            type: 'finished',
            rollId: command.rollId,
            results,
            metrics: { elapsedMs: Date.now() - startedAt, steps: physics.steps, frames: frameCount },
          });
          break;
        }
      }
    } finally {
      physics.dispose();
    }
  }
}
