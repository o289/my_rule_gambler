import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readClientMessage } from '../../../../shared/contracts/dice';
import type { ClientMessage, ServerMessage } from '../../../../shared/contracts/dice';
import { initPhysics } from '../../../../features/dice/server/physics';
import { startWebSocketTransport } from '../../../server/websocket';
import { DiceRoom } from './room';

const MAX_ROOMS = 24;

export interface HttpOptions { port: number; allowDev: boolean }

export async function startDiceServer(options: HttpOptions) {
  await initPhysics();
  const rooms = new Map<string, DiceRoom>();
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
        for (const [name, room] of rooms) if (room.prune(Date.now())) {
          room.dispose();
          rooms.delete(name);
        }
      },
      createSession(peer, controls) {
        let room: DiceRoom | null = null;
        let id: string | null = null;
        return {
          onMessage(message) {
            if (message.type === 'join' && !room) {
              const existing = rooms.get(message.room);
              if (!existing && message.token) {
                peer.send({ type: 'error', code: 'TOKEN', message: '前回のセッションは終了しています。' });
                peer.close(1008, 'session expired');
                return;
              }
              if (!existing && rooms.size >= MAX_ROOMS) {
                peer.send({ type: 'error', code: 'BUSY', message: '現在、新しいルームに参加できません。' });
                peer.close(1013, 'room limit');
                return;
              }
              room = existing ?? new DiceRoom(options.allowDev);
              rooms.set(message.room, room);
              id = room.join(peer, message);
              controls.joined();
              if (!id) peer.close(1008, 'join rejected');
            } else if (room && id && message.type !== 'join') {
              room.command(id, peer, message);
            }
          },
          onClose() {
            if (room && id) room.leave(id, peer);
          },
        };
      },
    },
  );

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    for (const room of rooms.values()) room.dispose();
    rooms.clear();
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
