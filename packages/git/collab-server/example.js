/** Runnable single-room authority. Configuration contains origin/scope metadata; the room secret is read only from the environment. */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CollabRoomServer } from '../src/collab/room-server.js';
import { GitError } from '../src/errors.js';
import { attachCollaborationWebSocketServer, FileCollaborationJournal } from './index.js';

const secret = process.env.SHARPFORGE_COLLAB_ROOM_TOKEN;
if (!secret || secret.length < 32) throw new GitError('Auth', 'Set SHARPFORGE_COLLAB_ROOM_TOKEN to a randomly generated room secret of at least 32 characters');
const digest = createHash('sha256').update(secret).digest();
const workspaceId = process.env.SHARPFORGE_COLLAB_WORKSPACE ?? 'workspace';
const roomId = process.env.SHARPFORGE_COLLAB_ROOM ?? 'team';
const documentId = process.env.SHARPFORGE_COLLAB_DOCUMENT ?? 'Program.cs';
const origins = (process.env.SHARPFORGE_COLLAB_ORIGINS ?? 'http://127.0.0.1:4173').split(',').map(value => value.trim()).filter(Boolean);
const port = Number(process.env.SHARPFORGE_COLLAB_PORT ?? 8787);
const address = process.env.SHARPFORGE_COLLAB_ADDRESS ?? '127.0.0.1';
const certificate = process.env.SHARPFORGE_COLLAB_TLS_CERT;
const key = process.env.SHARPFORGE_COLLAB_TLS_KEY;
if ((!certificate || !key) && !['127.0.0.1', '::1', 'localhost'].includes(address)) {
  throw new GitError('Unsafe', 'A non-loopback collaboration listener requires TLS certificate and key paths');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new GitError('Limit', 'Invalid collaboration listener port');
const authority = new CollabRoomServer({
  persistence: new FileCollaborationJournal({ directory: process.env.SHARPFORGE_COLLAB_JOURNAL ?? './collaboration-journal' }),
  authorize: ({ token, identity }) => {
    const received = createHash('sha256').update(token).digest();
    if (!timingSafeEqual(received, digest) || identity.workspaceId !== workspaceId || identity.roomId !== roomId
      || identity.documentId !== documentId) throw new GitError('Auth', 'Room authorization rejected');
    return { identity, permissions: { read: true, write: true } };
  }
});
const request = (incoming, response) => { response.writeHead(404, { 'Content-Length': '0' }); response.end(); };
const server = certificate && key
  ? createHttpsServer({ cert: await readFile(certificate), key: await readFile(key) }, request)
  : createHttpServer(request);
const adapter = attachCollaborationWebSocketServer(server, { authority, allowedOrigins: origins });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, address, resolve);
});
process.stdout.write('Collaboration authority listening on ' + (certificate ? 'wss://' : 'ws://') + address + ':' + port + '/collab\n');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  adapter.dispose();
  await authority.dispose();
  await new Promise(resolve => server.close(resolve));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  close().catch(() => { process.stderr.write('Collaboration shutdown failed\n'); process.exitCode = 1; });
});
