import type { RoomRuntime } from '../server/core/ports';

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createBoardSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return new DataView(bytes.buffer).getUint32(0, true);
}

export function createCloudflareRoomRuntime(): RoomRuntime {
  return {
    now: () => Date.now(),
    createPlayerId: () => crypto.randomUUID(),
    createToken,
    createBoardSeed,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    createRoll: () => { throw new Error('Dice commands are not enabled on this connection yet.'); },
    allowPreviewDev: false,
  };
}
