import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocket, WebSocketServer } from 'ws';
import { parseJson, readClientMessage } from '../../../../shared/contracts/casino-entry';
import { CasinoRoom } from './room';
import type { RoomPeer } from './room';

const MAX_ROOMS = 24;
const MAX_SOCKETS = 64;

export interface HttpOptions { port: number }

export async function startCasinoServer(options: HttpOptions) {
  const rooms = new Map<string, CasinoRoom>();
  const app = new Hono();
  app.get('/health', context => context.json({ ready: true }));

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const alive = new WeakSet<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    let sameOrigin = !req.headers.origin;
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        sameOrigin = (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost' || origin.hostname === '[::1]')
          && (origin.host === req.headers.host || origin.port === '5179');
      } catch { sameOrigin = false; }
    }
    if (req.url !== '/ws' || !sameOrigin || sockets.clients.size >= MAX_SOCKETS) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, connection => sockets.emit('connection', connection));
  });

  sockets.on('connection', socket => {
    let room: CasinoRoom | null = null;
    let id: string | null = null;
    let windowStart = performance.now();
    let packets = 0;
    alive.add(socket);
    const joinDeadline = setTimeout(() => socket.close(1008, 'join required'), 4500);
    const peer: RoomPeer = {
      send(message) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 524_288) {
          socket.terminate();
          return;
        }
        socket.send(JSON.stringify(message));
      },
      close: () => socket.close(4001, 'session replaced'),
    };
    socket.on('pong', () => alive.add(socket));
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(joinDeadline);
      if (room && id) room.leave(id, peer);
    });
    socket.on('message', (raw, binary) => {
      const now = performance.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        packets = 0;
      }
      if (++packets > 45 || binary) {
        socket.close(1008, 'input limit');
        return;
      }
      const message = readClientMessage(parseJson(raw.toString()));
      if (!message) {
        peer.send({ type: 'error', code: 'INPUT', message: '操作の形式を確認してください。' });
        return;
      }
      if (!room && (message.type === 'create' || message.type === 'join')) {
        clearTimeout(joinDeadline);
        if (message.type === 'create') {
          if (rooms.size >= MAX_ROOMS) {
            peer.send({ type: 'error', code: 'BUSY', message: '現在、新しいルームを作成できません。' });
            socket.close(1013, 'room limit');
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
            socket.close(4003, 'room not found');
            return;
          }
          room = existing;
          id = room.join(peer, message.token);
        }
        if (!id) socket.close(4003, 'join rejected');
      } else if (room && id && message.type === 'leave') {
        room.exit(id, peer);
        if (room.empty) {
          rooms.delete(room.info.id);
          room.dispose();
        }
        id = null;
        socket.close(1000, 'left room');
      } else if (room && id && (message.type === 'ready' || message.type === 'clock')) {
        room.command(id, peer, message);
      }
    });
  });

  const prune = setInterval(() => {
    for (const [name, room] of rooms) if (room.prune(Date.now())) {
      room.dispose();
      rooms.delete(name);
    }
    for (const client of sockets.clients) {
      if (!alive.delete(client)) client.terminate();
      else client.ping();
    }
  }, 15_000);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(prune);
    for (const room of rooms.values()) room.dispose();
    rooms.clear();
    for (const client of sockets.clients) client.terminate();
    sockets.close();
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
