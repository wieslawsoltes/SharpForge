import { createHash } from 'node:crypto';
import { CollaborationWebSocket } from './websocket-frames.js';

/** Attach dependency-free RFC 6455 framing to a Node HTTP or HTTPS server. */
export function attachCollaborationWebSocketServer(server, {
  authority, allowedOrigins = [], path = '/collab', allowMissingOrigin = false, maximumBytes = 2 * 1024 * 1024 + 4096
}) {
  if (!authority?.attach) throw new TypeError('A CollabRoomServer authority is required');
  const origins = new Set(allowedOrigins.map(origin => new URL(origin).origin));
  const sockets = new Set();
  function upgrade(request, socket, head) {
    const origin = request.headers.origin;
    const key = request.headers['sec-websocket-key'];
    const connection = String(request.headers.connection ?? '').toLowerCase().split(',').map(value => value.trim());
    const validOrigin = origin ? origins.has(origin) : allowMissingOrigin;
    const validKey = typeof key === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(key) && Buffer.from(key, 'base64').length === 16;
    if (request.method !== 'GET' || request.url !== path || !validOrigin || !validKey
      || String(request.headers.upgrade).toLowerCase() !== 'websocket' || !connection.includes('upgrade')
      || request.headers['sec-websocket-version'] !== '13') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + 'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const peer = new CollaborationWebSocket(socket, { maximumBytes, context: { origin, remoteAddress: socket.remoteAddress } });
    try {
      peer.bind(authority.attach(peer));
      sockets.add(peer);
      socket.once('close', () => sockets.delete(peer));
      if (head.length) peer.feed(head);
    } catch {
      peer.close(1011, 'Room service unavailable');
    }
  }
  server.on('upgrade', upgrade);
  return Object.freeze({
    dispose() {
      server.off('upgrade', upgrade);
      for (const peer of sockets) peer.close(1001, 'Server stopped');
      sockets.clear();
    }
  });
}

export { FileCollaborationJournal } from './journal.js';
