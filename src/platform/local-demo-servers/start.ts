import { RoomRegistry } from '../server/core/room-registry';
import { createNodeRoomRuntime } from './dice/server/room-runtime';
import { startDiceServer } from './dice/server/http';
import { startCasinoServer } from './casino-entry/server/http';

export async function startLocalDemoServers(options: {
  dicePort: number;
  casinoPort: number;
  allowDev: boolean;
  countdownMs?: number;
}) {
  const registry = new RoomRegistry(createNodeRoomRuntime({ allowPreviewDev: options.allowDev }), options.countdownMs);
  let dice: Awaited<ReturnType<typeof startDiceServer>> | null = null;
  let casino: Awaited<ReturnType<typeof startCasinoServer>> | null = null;
  try {
    dice = await startDiceServer({ port: options.dicePort, allowDev: options.allowDev, registry });
    casino = await startCasinoServer({ port: options.casinoPort, registry });
  } catch (error) {
    casino?.close();
    dice?.close();
    registry.dispose();
    throw error;
  }
  let closed = false;
  return {
    dicePort: dice.port,
    casinoPort: casino.port,
    close() {
      if (closed) return;
      closed = true;
      casino?.close();
      dice?.close();
      registry.dispose();
    },
  };
}
