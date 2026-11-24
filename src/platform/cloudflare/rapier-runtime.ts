import RAPIER from '@dimforge/rapier3d';
// Wrangler compiles this package asset to a WebAssembly.Module for Workers.
import rapierWasm from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm';
// @ts-expect-error The generated glue subpath has no package declaration.
import * as rapierGlue from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import type { PhysicsRuntime } from '../../features/dice/server/physics';

const rapierApi = RAPIER as unknown as PhysicsRuntime;
const glue = rapierGlue as unknown as { __wbg_set_wasm(exports: WebAssembly.Exports): void };
let initialized = false;

/** Instantiates the bundled wasm module once per isolate and returns the shared Rapier API. */
export function initializeCloudflareRapier() {
  if (!initialized) {
    const instance = new WebAssembly.Instance(rapierWasm, { './rapier_wasm3d_bg.js': rapierGlue });
    glue.__wbg_set_wasm(instance.exports);
    initialized = true;
  }
  return rapierApi;
}
