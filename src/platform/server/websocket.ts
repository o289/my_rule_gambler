import { WebSocket, WebSocketServer } from 'ws';

export interface SocketPeer<TMessage> {
  send(message: TMessage, transient?: boolean): boolean;
  close(code?: number, reason?: string): void;
}

export interface SocketSession<TClientMessage> {
  onMessage(message: TClientMessage): void;
  onClose(): void;
}

export interface SocketSessionControls {
  joined(): void;
}

export type UpgradeListener = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void;

export interface WebSocketTransportOptions<TClientMessage, TServerMessage> {
  originFallbackPort: string;
  decodeMessage(value: unknown): TClientMessage | null;
  inputError: TServerMessage;
  createSession(peer: SocketPeer<TServerMessage>, controls: SocketSessionControls): SocketSession<TClientMessage>;
  onMaintenance?(): void;
}

const MAX_SOCKETS = 64;
const MAX_MESSAGE_BYTES = 4096;
const MAX_SEND_QUEUE_BYTES = 524_288;
const MAX_TRANSIENT_QUEUE_BYTES = 98_304;

function isAllowedOrigin(originHeader: string | undefined, hostHeader: string | undefined, fallbackPort: string) {
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    return (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost' || origin.hostname === '[::1]')
      && (origin.host === hostHeader || origin.port === fallbackPort);
  } catch {
    return false;
  }
}

export function startWebSocketTransport<TClientMessage, TServerMessage>(
  addUpgradeListener: (listener: UpgradeListener) => void,
  removeUpgradeListener: (listener: UpgradeListener) => void,
  options: WebSocketTransportOptions<TClientMessage, TServerMessage>,
) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const alive = new WeakSet<WebSocket>();
  let closed = false;

  const onUpgrade: UpgradeListener = (req, socket, head) => {
    if (req.url !== '/ws' || !isAllowedOrigin(req.headers.origin, req.headers.host, options.originFallbackPort)
      || sockets.clients.size >= MAX_SOCKETS) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, connection => sockets.emit('connection', connection));
  };
  addUpgradeListener(onUpgrade);

  sockets.on('connection', socket => {
    alive.add(socket);
    let windowStart = performance.now();
    let packets = 0;
    let initialMessageTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      initialMessageTimer = null;
      socket.close(1008, 'join required');
    }, 4500);

    const peer: SocketPeer<TServerMessage> = {
      send(message, transient = false) {
        if (socket.readyState !== WebSocket.OPEN) return false;
        if (socket.bufferedAmount > MAX_SEND_QUEUE_BYTES) {
          socket.terminate();
          return false;
        }
        if (transient && socket.bufferedAmount > MAX_TRANSIENT_QUEUE_BYTES) return false;
        socket.send(JSON.stringify(message));
        return true;
      },
      close: (code = 4001, reason = 'session replaced') => socket.close(code, reason),
    };
    const controls: SocketSessionControls = {
      joined() {
        if (initialMessageTimer) clearTimeout(initialMessageTimer);
        initialMessageTimer = null;
      },
    };
    const session = options.createSession(peer, controls);

    socket.on('pong', () => alive.add(socket));
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      if (initialMessageTimer) clearTimeout(initialMessageTimer);
      initialMessageTimer = null;
      session.onClose();
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
      let value: unknown;
      try {
        value = JSON.parse(raw.toString());
      } catch {
        value = null;
      }
      const message = options.decodeMessage(value);
      if (message === null) {
        peer.send(options.inputError);
        return;
      }
      session.onMessage(message);
    });
  });

  const maintenance = setInterval(() => {
    options.onMaintenance?.();
    for (const client of sockets.clients) {
      if (!alive.delete(client)) client.terminate();
      else client.ping();
    }
  }, 15_000);

  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(maintenance);
      removeUpgradeListener(onUpgrade);
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    },
  };
}
