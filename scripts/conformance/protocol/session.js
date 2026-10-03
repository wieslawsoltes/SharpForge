import {readFile, stat} from 'node:fs/promises';
export async function readSession(path) {
  const info = await stat(path); if (info.size > 32 * 1024 * 1024) throw new Error('Session exceeds 32 MiB');
  const session = JSON.parse(await readFile(path, 'utf8')); validateSession(session); return session;
}
export function validateSession(session) {
  if (session?.schemaVersion !== 1 || !['lsp', 'dap'].includes(session.protocol)
      || !['recording', 'synthetic'].includes(session.kind) || session.complete !== true
      || !Array.isArray(session.messages) || !session.messages.length || session.messages.length > 10000) throw new Error('Invalid or incomplete protocol session');
  if (session.kind === 'recording' && (session.client?.name !== 'Visual Studio Code' || !session.client.version
      || session.capture?.tool !== 'sharpforge-stdio-recorder' || !/^[a-f0-9]{40}$/.test(session.capture.serverCommit ?? ''))) throw new Error('Recording lacks VS Code capture provenance');
  for (const row of session.messages) if (!['clientToServer', 'serverToClient'].includes(row.direction)
      || !row.message || typeof row.message !== 'object' || Array.isArray(row.message)) throw new Error('Malformed session message');
}
