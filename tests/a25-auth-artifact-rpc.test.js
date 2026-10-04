import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { readZip, writeZip } from '../packages/archive/src/index.js';
import { GitService } from '../packages/git/src/service.js';
import { GitWorkerClient } from '../packages/git/src/worker/client.js';
import { createGitWorkerServer } from '../packages/git/src/worker/server.js';
import { GitError } from '../packages/git/src/errors.js';
import { createGitAuthContext } from '../packages/git/src/auth/context.js';
import { createAuthOperations } from '../packages/git/src/auth/service.js';
import { createArtifactFilters } from '../apps/studio/services/artifacts.js';
import { downloadStudioArtifact } from '../apps/studio/services/downloads.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const secret = 'planted-artifact-rpc-private-token';

async function worker(t) {
  const { port1, port2 } = new MessageChannel();
  const context = createGitAuthContext();
  const server = createGitWorkerServer({ endpoint: port1, createService: () => new GitService({
    repositoryFactory: async () => { throw new Error('Artifact sanitation must not open a repository'); },
    operations: createAuthOperations(context), resources: [context],
    serializeError: error => context.redactor.value(GitError.from(error).toJSON())
  }) });
  const client = new GitWorkerClient(port2, { session: 'auth-artifact-fixture' });
  t.after(async () => {
    await client.dispose();
    await server.dispose();
    port1.close();
    port2.close();
  });
  await client.request('git.auth', { method: 'setCredential', params: {
    id: 'account', remoteId: 'origin', origins: ['https://gitlab.example'], grantConsent: true,
    credential: { provider: 'gitlab', kind: 'pat', accessToken: secret, allowedOrigins: ['https://gitlab.example'] }
  } });
  return artifact => client.request('git.auth', { method: 'sanitizeArtifact', params: artifact });
}

test('A25 real worker artifact RPC removes vault values from ZIP, project JSON, diagnostics and publish bytes', async t => {
  const sanitize = await worker(t);
  const remote = `https://user:${secret}@gitlab.example/acme/project`;
  const zip = writeZip([{ path: 'source.cs', text: `// token ${secret}\n// ${remote}` },
    { path: 'binary.dat', bytes: new Uint8Array([0, 1, 254, 255]) }]);
  const archived = await sanitize({ name: 'workspace.zip', mimeType: 'application/zip', bytes: zip });
  assert.equal(archived.bytes instanceof Uint8Array, true);
  const files = readZip(archived.bytes);
  assert.equal(files.find(file => file.path === 'source.cs').bytes.includes(0), false);
  assert.equal(decoder.decode(files.find(file => file.path === 'source.cs').bytes).includes(secret), false);
  assert.deepEqual(files.find(file => file.path === 'binary.dat').bytes, new Uint8Array([0, 1, 254, 255]));
  for (const name of ['workspace.sharpforge.json', 'diagnostics.json']) {
    const result = await sanitize({ name, mimeType: 'application/json', bytes: encoder.encode(JSON.stringify({
      message: secret, remote, nested: { client_secret: 'unregistered-secret', access_token: secret }, [secret]: 'key'
    })) });
    const text = decoder.decode(result.bytes);
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes('unregistered-secret'), false);
    const value = JSON.parse(text);
    assert.equal(value.remote, 'https://gitlab.example/acme/project');
    assert.equal(value.nested.client_secret, '[REDACTED]');
  }
  const published = await sanitize({ name: 'index.html', mimeType: 'text/html',
    bytes: encoder.encode(`<p>${secret}</p><a href="${remote}">repository</a>`) });
  assert.equal(decoder.decode(published.bytes).includes(secret), false);
});

test('A25 real artifact RPC blocks binary secrets, invalid JSON, oversized payloads, and preserves canonical bundle bytes', async t => {
  const sanitize = await worker(t);
  const binary = new Uint8Array([0, ...encoder.encode(secret), 0xff]);
  await assert.rejects(sanitize({ name: 'image.bin', bytes: binary }), error => error.code === 'Unsafe' && !JSON.stringify(error).includes(secret));
  for (const littleEndian of [false, true]) {
    const utf16 = new Uint8Array(secret.length * 2 + 1);
    const view = new DataView(utf16.buffer);
    for (let index = 0; index < secret.length; index++) view.setUint16(index * 2 + 1, secret.charCodeAt(index), littleEndian);
    await assert.rejects(sanitize({ name: 'native.bin', bytes: utf16 }), { code: 'Unsafe' });
  }
  await assert.rejects(sanitize({ name: 'workspace.sharpforge.json', bytes: encoder.encode('{') }), { code: 'Corrupt' });
  await assert.rejects(sanitize({ name: 'big.bin', bytes: new Uint8Array(64 * 1024 * 1024 + 1) }), { code: 'Limit' });
  const bundle = encoder.encode('# v3 git bundle\n@object-format=sha1\n\nPACK');
  const preserved = await sanitize({ name: 'repo.bundle', mimeType: 'application/zip', bytes: bundle });
  assert.deepEqual(preserved.bytes, bundle);
});

test('Studio downloads actual worker-sanitized workspace artifacts and blocks unsafe binary delivery', async t => {
  const sanitize = await worker(t);
  const artifacts = createArtifactFilters();
  artifacts.register('git.credentials', sanitize);
  const downloads = [];
  const errors = [];
  const host = { artifacts, urls: { createObjectURL: blob => { downloads.push(blob); return 'blob:fixture'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) }, schedule() {}, onError: error => errors.push(error) };
  const zip = writeZip([{ path: 'source.cs', text: `// ${secret}` }]);
  const savedZip = await downloadStudioArtifact(host, 'workspace.zip', zip, 'application/zip');
  assert.ok(savedZip);
  const downloadedZip = new Uint8Array(await downloads[0].arrayBuffer());
  assert.equal(decoder.decode(readZip(downloadedZip)[0].bytes).includes(secret), false);
  const savedJson = await downloadStudioArtifact(host, 'workspace.sharpforge.json', JSON.stringify({ files: [{ text: secret }] }));
  assert.ok(savedJson);
  assert.equal((await downloads[1].text()).includes(secret), false);
  const unsafe = new Uint8Array([0, ...encoder.encode(secret), 255]);
  assert.equal(await downloadStudioArtifact(host, 'private.bin', unsafe, 'application/octet-stream'), null);
  assert.equal(downloads.length, 2);
  assert.equal(errors[0].code, 'Unsafe');
  artifacts.dispose();
});
