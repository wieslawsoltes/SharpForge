import test from 'node:test';
import assert from 'node:assert/strict';
import { readZip, writeZip } from '../packages/archive/src/index.js';
import { SecretRedactor } from '../packages/git/src/redact.js';
import { sanitizeGitExportFiles, sanitizeGitExportZip } from '../packages/git/src/redact-artifacts.js';
import { GitSettingsModel } from '../apps/studio/git-settings.js';
import { GitOriginGrants } from '../packages/git/src/origins.js';
import { completeGitOAuthCallback } from '../apps/studio/git-oauth-callback.js';
import { createGitAuthSetup } from '../apps/studio/git-auth-setup.js';

const token = 'planted-vault-secret-123456789';

test('A25 planted vault secret is absent from ZIP, workspace JSON, diagnostics and published files', () => {
  const redactor = new SecretRedactor();
  redactor.registerCredential({ accessToken: token, provider: 'github' });
  const remote = `https://x-access-token:${token}@github.com/acme/project`;
  const original = writeZip([{ path: 'README.md', text: `Remote ${remote}; secret ${token}` }]);
  const zip = sanitizeGitExportZip(original, redactor);
  const zipEntries = readZip(zip);
  const workspaceJson = JSON.stringify(redactor.value({ name: 'Project', remote, authentication: { accessToken: token } }));
  const diagnostics = JSON.stringify(redactor.value([{ severity: 'error', message: `Authentication failure ${token}` }]));
  const published = sanitizeGitExportFiles([{ path: 'app.js', text: `const url=${JSON.stringify(remote)};` }], redactor);
  for (const output of [new TextDecoder().decode(zip), new TextDecoder().decode(zipEntries[0].bytes),
    workspaceJson, diagnostics, published[0].text]) {
    assert.equal(output.includes(token), false);
    assert.equal(output.includes('x-access-token:'), false);
  }
  assert.equal(new TextDecoder().decode(zipEntries[0].bytes).includes('https://github.com/acme/project'), true);
});

test('A25 binary exports containing tokens fail before publication and safe bytes round-trip', () => {
  const redactor = new SecretRedactor();
  redactor.register(token);
  const unsafe = new Uint8Array([255, ...new TextEncoder().encode(token)]);
  assert.throws(() => sanitizeGitExportFiles([{ path: 'binary.bin', bytes: unsafe }], redactor), { code: 'Unsafe' });
  const safe = new Uint8Array([255, 0, 254]);
  assert.deepEqual(sanitizeGitExportFiles([{ path: 'binary.bin', bytes: safe }], redactor)[0].bytes, safe);
});

test('A25 settings closed schema excludes secrets and regenerates only required proxy CSP origins', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const model = new GitSettingsModel({ storage, grants: new GitOriginGrants(),
    remotes: [{ id: 'origin', url: 'https://github.com/acme/project' }] });
  model.update({ userName: 'Example', userEmail: 'example@example.com', accessToken: token, proxyOrigin: 'https://proxy.example' });
  const settings = model.describe();
  assert.equal([...entries.values()].join('').includes(token), false);
  assert.deepEqual(settings.requiredOrigins, ['https://api.github.com', 'https://github.com', 'https://proxy.example']);
  const changed = model.update({ proxyOrigin: 'https://next.example' });
  assert.equal(changed.csp.includes('https://next.example'), true);
  assert.equal(changed.csp.includes('https://proxy.example'), false);
  assert.deepEqual(model.grants.allowedOrigins(), []);
  const reloaded = new GitSettingsModel({ storage }).load();
  assert.equal(reloaded.userName, 'Example');
  assert.equal(reloaded.credentialPersistence, 'session');
  assert.throws(() => model.update({ proxyOrigin: 'https://token@proxy.example' }), { code: 'Unsafe' });
  assert.throws(() => model.update({ defaultBranch: '../escape' }), { code: 'Unsafe' });
});

test('A25 callback clears the temporary code from history and uses exact opener target origin', () => {
  let historyUrl;
  let message;
  const status = { textContent: '' };
  const window = { location: { href: 'https://ide.example/git-oauth-callback.html?state=expected&code=one-use' },
    history: { replaceState: (_, __, url) => { historyUrl = url; } },
    opener: { postMessage: (data, origin) => { message = { data, origin }; } } };
  const result = completeGitOAuthCallback({ window, document: { getElementById: () => status } });
  assert.equal(result, true);
  assert.equal(historyUrl.includes('one-use'), false);
  assert.equal(message.origin, 'https://ide.example');
  assert.equal(message.data.type, 'sharpforge.git.oauth.callback');
  assert.equal(status.textContent.includes('one-use'), false);
});

test('A25 settings include granted collaboration WSS origins in displayed deployment CSP', () => {
  const grants = new GitOriginGrants();
  grants.grant('collaboration', ['wss://collaboration.example']);
  const model = new GitSettingsModel({ grants });
  assert.deepEqual(model.describe().requiredOrigins, ['wss://collaboration.example']);
  assert.equal(model.describe().csp.includes('wss://collaboration.example'), true);
  grants.revoke('collaboration', 'wss://collaboration.example');
  assert.equal(model.describe().csp.includes('wss://collaboration.example'), false);
});

test('A25 OAuth settings store public registration only and setup waits for a sign-in action before grants', () => {
  const entries = new Map();
  const model = new GitSettingsModel({ storage: { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) },
    remotes: [{ id: 'origin', provider: 'azure', url: 'https://dev.azure.com/acme/Project/_git/Repo' }] });
  const settings = model.update({ clientId: 'public-client-id', clientSecret: token, brokerOrigin: 'https://broker.example',
    redirectUri: 'https://ide.example/git-oauth-callback.html' });
  assert.equal([...entries.values()].join('').includes(token), false);
  assert.equal(settings.requiredOrigins.includes('https://login.microsoftonline.com'), true);
  assert.equal(settings.requiredOrigins.includes('https://broker.example'), true);
  let requests = 0;
  const setup = createGitAuthSetup({ settings: model, grants: model.grants, provider: 'azure', remoteId: 'origin',
    remote: model.remotes[0].url, invoke: async () => { requests++; },
    window: { location: { href: 'https://ide.example/', origin: 'https://ide.example' } } });
  assert.equal(typeof setup.deviceFlow.authorize, 'function');
  assert.equal(typeof setup.pkceFlow, 'function');
  assert.equal(requests, 0);
  assert.deepEqual(model.grants.allowedOrigins(), []);
});
