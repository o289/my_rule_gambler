import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readClientMessage } from '../../../../shared/contracts/casino-entry';
import type { ClientMessage, ServerMessage } from '../../../../shared/contracts/casino-entry';
import { startWebSocketTransport } from '../../../server/websocket';
import { CasinoRoom } from './room';

const MAX_ROOMS = 24;

export interface HttpOptions { port: number }

export async function startCasinoServer(options: HttpOptions) {
  const rooms = new Map<string, CasinoRoom>();
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
        for (const [name, room] of rooms) if (room.prune(Date.now())) {
          room.dispose();
          rooms.delete(name);
        }
      },
      createSession(peer, controls) {
        let room: CasinoRoom | null = null;
        let id: string | null = null;
        return {
          onMessage(message) {
            if (!room && (message.type === 'create' || message.type === 'join')) {
              controls.joined();
              if (message.type === 'create') {
                if (rooms.size >= MAX_ROOMS) {
                  peer.send({ type: 'error', code: 'BUSY', message: '現在、新しいルームを作成できません。' });
                  peer.close(1013, 'room limit');
                  return;
                }
                let roomId = randomBytes(4).toString('hex');
                while (rooms.has(roomId)) roomId = randomBytes(4).toString('hex');
                room = new CasinoRoom({ id: roomId, name: message.name });
                rooms.set(roomId, room);
                id = room.join(peer);
              } else {
                const existing = rooms.get(message.room);
                if (!existing) {
                  const error = message.token
                    ? { code: 'TOKEN', message: '前回のセッションは終了しています。' }
                    : { code: 'NOT_FOUND', message: 'ルームが見つかりません。IDを確認してください。' };
                  peer.send({ type: 'error', ...error });
                  peer.close(4003, 'room not found');
                  return;
                }
                room = existing;
                id = room.join(peer, message.token);
              }
              if (!id) peer.close(4003, 'join rejected');
            } else if (room && id && message.type === 'leave') {
              room.exit(id, peer);
              if (room.empty) {
                rooms.delete(room.info.id);
                room.dispose();
              }
              id = null;
              peer.close(1000, 'left room');
            } else if (room && id && (message.type === 'ready' || message.type === 'clock')) {
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
