import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readClientMessage } from '../../../../shared/contracts/casino-entry';
import type { ClientMessage, ServerMessage } from '../../../../shared/contracts/casino-entry';
import { startWebSocketTransport } from '../../../server/websocket';
import { RoomRegistry } from '../../../server/core/room-registry';
import type { RoomPeer } from '../../../server/core/room';
import { createNodeRoomRuntime } from '../../dice/server/room-runtime';

export interface HttpOptions { port: number; registry?: RoomRegistry; countdownMs?: number }

export async function startCasinoServer(options: HttpOptions) {
  const ownsRegistry = !options.registry;
  const registry = options.registry ?? new RoomRegistry(createNodeRoomRuntime({ allowPreviewDev: false }), options.countdownMs);
  const app = new Hono();
  app.get('/health', context => context.json({ ready: true }));

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port });
  const transport = startWebSocketTransport<ClientMessage, ServerMessage>(
    listener => server.on('upgrade', listener),
    listener => server.off('upgrade', listener),
    {
      originFallbackPort: '5179',
      decodeMessage: readClientMessage,
      inputError: { type: 'error', code: 'INPUT', message: '操作の形式を確認してください。' },
      onMaintenance() {
        registry.prune(Date.now());
      },
      createSession(peer, controls) {
        let room: import('../../../server/core/room').Room | null = null;
        let id: string | null = null;
        const roomPeer: RoomPeer = { protocol: 'lobby', send: message => peer.send(message), close: (code, reason) => peer.close(code, reason) };
        return {
          onMessage(message) {
            if (!room && (message.type === 'create' || message.type === 'join')) {
              controls.joined();
              if (message.type === 'create') {
                if (!registry.canCreate('standard')) {
                  peer.send({ type: 'error', code: 'BUSY', message: '現在、新しいルームを作成できません。' });
                  peer.close(1013, 'room limit');
                  return;
                }
                let roomId = randomBytes(4).toString('hex');
                while (registry.get(roomId)) roomId = randomBytes(4).toString('hex');
                room = registry.create({ id: roomId, name: message.name });
                id = room?.connectLobby(roomPeer) ?? null;
              } else {
                const existing = registry.get(message.room);
                if (!existing) {
                  const error = message.token
                    ? { code: 'TOKEN', message: '前回のセッションは終了しています。' }
                    : { code: 'NOT_FOUND', message: 'ルームが見つかりません。IDを確認してください。' };
                  peer.send({ type: 'error', ...error });
                  peer.close(4003, 'room not found');
                  return;
                }
                room = existing;
                id = room.connectLobby(roomPeer, message.token);
              }
              if (!id) peer.close(4003, 'join rejected');
            } else if (room && id && message.type === 'leave') {
              room.exitLobby(id, roomPeer);
              registry.deleteIfEmpty(room.info.id);
              id = null;
              peer.close(1000, 'left room');
            } else if (room && id && (message.type === 'ready' || message.type === 'clock')) {
              room.commandLobby(id, roomPeer, message);
            }
          },
          onClose() {
            if (room && id) room.disconnect(id, roomPeer);
          },
        };
      },
    },
  );

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (ownsRegistry) registry.dispose();
    transport.close();
    server.close();
  }

  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (typeof address !== 'object' || !address) throw new Error('サーバーのポートを取得できません。');
    return { port: address.port, close };
  } catch (error) {
    close();
    throw error;
  }
}
