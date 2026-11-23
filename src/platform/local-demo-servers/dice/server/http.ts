import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readClientMessage } from '../../../../shared/contracts/dice';
import type { ClientMessage, ServerMessage } from '../../../../shared/contracts/dice';
import { initPhysics } from '../../../../features/dice/server/physics';
import { startWebSocketTransport } from '../../../server/websocket';
import { NORMAL_ROOM_ID, RoomRegistry } from '../../../server/core/room-registry';
import type { DicePeer } from '../../../server/core/room';
import { createNodeRoomRuntime } from './room-runtime';

export interface HttpOptions { port: number; allowDev: boolean; registry?: RoomRegistry; countdownMs?: number }

export async function startDiceServer(options: HttpOptions) {
  await initPhysics();
  const ownsRegistry = !options.registry;
  const registry = options.registry ?? new RoomRegistry(createNodeRoomRuntime({ allowPreviewDev: options.allowDev }), options.countdownMs);
  const app = new Hono();
  app.get('/health', context => context.json({ ready: true }));

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port });
  const transport = startWebSocketTransport<ClientMessage, ServerMessage>(
    listener => server.on('upgrade', listener),
    listener => server.off('upgrade', listener),
    {
      originFallbackPort: '5178',
      decodeMessage: readClientMessage,
      inputError: { type: 'error', code: 'INPUT', message: '操作の形式を確認してください。' },
      onMaintenance() {
        registry.prune(Date.now());
      },
      createSession(peer, controls) {
        let room: import('../../../server/core/room').Room | null = null;
        let id: string | null = null;
        let roomPeer: DicePeer | null = null;
        return {
          onMessage(message) {
            if (message.type === 'join' && !room) {
              const existing = NORMAL_ROOM_ID.test(message.room)
                ? registry.get(message.room)
                : registry.getPreview(message.room) ?? (!message.token ? registry.createPreview(message.room) : null);
              if (!existing && message.token) {
                peer.send({ type: 'error', code: 'TOKEN', message: '前回のセッションは終了しています。' });
                peer.close(1008, 'session expired');
                return;
              }
              if (!existing && !NORMAL_ROOM_ID.test(message.room) && !registry.canCreate('preview')) {
                peer.send({ type: 'error', code: 'BUSY', message: '現在、新しいルームに参加できません。' });
                peer.close(1013, 'room limit');
                return;
              }
              if (!existing) {
                peer.send({ type: 'error', code: 'NOT_FOUND', message: 'ルームが見つかりません。' });
                peer.close(4003, 'room not found');
                return;
              }
              room = existing;
              roomPeer = { protocol: 'dice', send: (outgoing, transient) => peer.send(outgoing, transient), close: (code, reason) => peer.close(code, reason) };
              id = room.connectDice(roomPeer, { token: message.token, dev: message.dev });
              controls.joined();
              if (!id) peer.close(1008, 'join rejected');
            } else if (room && id && message.type !== 'join') {
              if (roomPeer) room.commandDice(id, roomPeer, message);
            }
          },
          onClose() {
            if (room && id && roomPeer) room.disconnect(id, roomPeer);
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
