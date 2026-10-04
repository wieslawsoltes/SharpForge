import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderTransport } from '../packages/git/src/providers/index.js';
import { GitOriginGrants, requiredGitOrigins } from '../packages/git/src/origins.js';
import { GitPermissions } from '../packages/git/src/permissions.js';

const parent = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const blob = 'c'.repeat(40);
const next = 'd'.repeat(40);
const content = new Uint8Array([0, 1, 254, 255]);

const fixtures = [
  { provider: 'github', remote: 'https://github.com/acme/project', prefix: '/repos/acme/project', scopes: ['repo'],
    refs: ['/git/matching-refs/', [{ ref: 'refs/heads/main', object: { sha: parent } }]],
    commit: [`/git/commits/${parent}`, { sha: parent, tree: { sha: tree }, parents: [], message: 'Initial' }],
    tree: [`/git/trees/${tree}`, { tree: [{ path: 'file.bin', type: 'blob', sha: blob, mode: '100644' }], truncated: false }],
    blob: [`/git/blobs/${blob}`, { encoding: 'base64', content: 'AAH+/w==' }] },
  { provider: 'gitlab', remote: 'https://gitlab.example/acme/project', prefix: '/api/v4/projects/acme%2Fproject', scopes: ['api'],
    refs: ['/repository/branches', [{ name: 'main', commit: { id: parent } }]], tags: ['/repository/tags', []],
    commit: [`/repository/commits/${parent}`, { id: parent, parent_ids: [], message: 'Initial' }],
    tree: ['/repository/tree', [{ path: 'file.bin', type: 'blob', id: blob, mode: '100644' }]],
    blob: [`/repository/blobs/${blob}/raw`, content] },
  { provider: 'bitbucket', remote: 'https://bitbucket.org/acme/project', prefix: '/2.0/repositories/acme/project', scopes: ['repository:write'],
    refs: ['/refs/branches', { values: [{ name: 'main', target: { hash: parent } }] }], tags: ['/refs/tags', { values: [] }],
    commit: [`/commit/${parent}`, { hash: parent, parents: [], message: 'Initial', author: { raw: 'Author <author@example.com>' } }],
    tree: [`/src/${parent}/`, { values: [{ path: 'file.bin', type: 'commit_file', attributes: [] }] }],
    blob: [`/src/${parent}/file.bin`, content] },
  { provider: 'azure', remote: 'https://dev.azure.com/acme/Project/_git/Repo', prefix: '/acme/Project/_apis/git/repositories/Repo',
    scopes: ['vso.code_write'], refs: ['/refs', { value: [{ name: 'refs/heads/main', objectId: parent }] }],
    commit: [`/commits/${parent}`, { commitId: parent, treeId: tree, parents: [], comment: 'Initial' }],
    tree: [`/trees/${tree}`, { treeEntries: [{ relativePath: 'file.bin', objectId: blob, gitObjectType: 'blob', mode: '100644' }] }],
    blob: [`/blobs/${blob}`, content] },
  { provider: 'gitea', remote: 'https://gitea.example/acme/project', prefix: '/api/v1/repos/acme/project', scopes: ['write:repository'],
    refs: ['/git/refs', [{ ref: 'refs/heads/main', object: { sha: parent } }]],
    commit: [`/git/commits/${parent}`, { sha: parent, tree: { sha: tree }, parents: [], message: 'Initial' }],
    tree: [`/git/trees/${tree}`, { tree: [{ path: 'file.bin', type: 'blob', sha: blob, mode: '100644' }], truncated: false }],
    blob: [`/git/blobs/${blob}`, { encoding: 'base64', content: 'AAH+/w==' }] }
];

function transport(fixture, extra = {}) {
  const requests = [];
  const origins = requiredGitOrigins(fixture.remote, fixture);
  const route = new Map([fixture.refs, fixture.commit, fixture.tree, fixture.blob, fixture.tags].filter(Boolean)
    .map(([path, value]) => [fixture.prefix + path, value]));
  const instance = createProviderTransport({ ...fixture, grants: new GitOriginGrants({ grants: { origin: origins } }),
    remoteId: 'origin', credentialProvider: () => ({ provider: fixture.provider, kind: 'oauth', accessToken: 'fixture-token',
      allowedOrigins: origins, scopes: fixture.scopes }), permissions: new GitPermissions({ confirm: () => true }),
    fetch: async (url, request) => {
      const path = new URL(url).pathname;
      requests.push({ path, request });
      if (extra.fetch) {
        const response = await extra.fetch(path, request);
        if (response) return response;
      }
      if (!route.has(path)) throw new Error(`Unexpected fixture endpoint ${path}`);
      const value = route.get(path);
      return value instanceof Uint8Array ? new Response(value) : Response.json(value);
    } });
  return { instance, requests };
}

for (const fixture of fixtures) {
  test(`A25 ${fixture.provider} ProviderTransport conformance reads an immutable binary snapshot`, async () => {
    const { instance, requests } = transport(fixture);
    const snapshot = await instance.readSnapshot();
    assert.equal(snapshot.oid, parent);
    assert.equal(snapshot.files[0].path, 'file.bin');
    assert.deepEqual(snapshot.files[0].content, content);
    assert.equal(instance.getCapabilities().canonicalObjects, false);
    assert.throws(() => instance.getObject(parent), { code: 'Unsupported' });
    assert.equal(requests.every(value => value.request.method === 'GET'), true);
  });
}

test('A25 GitHub reads, writes git data, and pushes through GraphQL CAS with no smart HTTP', async () => {
  let refUpdate;
  const writes = [];
  const { instance, requests } = transport(fixtures[0], { fetch: async (path, request) => {
    if (request.method === 'POST') writes.push({ path, body: JSON.parse(request.body) });
    if (path.endsWith('/git/blobs') && request.method === 'POST') return Response.json({ sha: blob }, { status: 201 });
    if (path.endsWith('/git/trees') && request.method === 'POST') return Response.json({ sha: tree }, { status: 201 });
    if (path.endsWith('/git/commits') && request.method === 'POST') return Response.json({ sha: next }, { status: 201 });
    if (path === '/repos/acme/project') return Response.json({ node_id: 'Repository_Node' });
    if (path === '/graphql') {
      refUpdate = JSON.parse(request.body).variables.input;
      return Response.json({ data: { updateRefs: { clientMutationId: null } } });
    }
  } });
  const snapshot = await instance.readSnapshot();
  const result = await instance.commitFiles({ ref: snapshot.ref, expectedOid: snapshot.oid,
    message: 'Edit binary', files: [{ path: 'file.bin', content }] });
  assert.equal(result.oid, next);
  assert.equal(result.refUpdated, true);
  assert.equal(writes[0].body.content, 'AAH+/w==');
  assert.deepEqual(refUpdate.refUpdates, [{ name: 'refs/heads/main', beforeOid: parent, afterOid: next, force: false }]);
  assert.equal(requests.some(value => /git-upload-pack|git-receive-pack|info\/refs/.test(value.path)), false);
});

test('A25 GitHub compare-and-swap failure is explicit and stale snapshot blocks object writes', async () => {
  const { instance, requests } = transport(fixtures[0]);
  await assert.rejects(instance.createCommit({ ref: 'main', expectedOid: next, message: 'Stale', files: [] }), { code: 'Conflict' });
  assert.equal(requests.some(value => value.request.method !== 'GET'), false);
  const guarded = transport(fixtures[0], { fetch: async path => {
    if (path === '/repos/acme/project') return Response.json({ node_id: 'Repository_Node' });
    if (path === '/graphql') return Response.json({ errors: [{ message: 'beforeOid changed' }] });
  } }).instance;
  await assert.rejects(guarded.updateRef({ name: 'main', oldOid: parent, newOid: next }), { code: 'Conflict' });
});

test('A25 Azure push uses oldObjectId CAS and byte-preserving base64 content', async () => {
  let body;
  const { instance } = transport(fixtures[3], { fetch: async (path, request) => {
    if (path.endsWith('/pushes')) {
      body = JSON.parse(request.body);
      return Response.json({ commits: [{ commitId: next, treeId: tree, parents: [parent] }] }, { status: 201 });
    }
  } });
  const result = await instance.createCommit({ ref: 'main', expectedOid: parent, message: 'Edit binary',
    files: [{ path: 'file.bin', content, previousOid: blob }] });
  assert.equal(result.refUpdated, true);
  assert.equal(body.refUpdates[0].oldObjectId, parent);
  assert.equal(body.commits[0].changes[0].newContent.content, 'AAH+/w==');
  await assert.rejects(instance.updateRefs([{ name: 'main', oldOid: parent, newOid: next },
    { name: 'other', oldOid: parent, newOid: next }], { atomic: true }), { code: 'Unsupported' });
});

test('A25 action providers never pretend a preflight read is an atomic compare-and-swap', async () => {
  for (const fixture of [fixtures[1], fixtures[2], fixtures[4]]) {
    const { instance, requests } = transport(fixture);
    await assert.rejects(instance.createCommit({ ref: 'main', expectedOid: parent, message: 'Edit', files: [] }), { code: 'Unsupported' });
    assert.equal(requests.length, 0);
    assert.throws(() => instance.updateRef({ name: 'main', oldOid: parent, newOid: next }), { code: 'Unsupported' });
  }
});

test('A25 GitLab file-consistency commit includes documented last_commit_id guard and no force', async () => {
  let body;
  const { instance } = transport(fixtures[1], { fetch: async (path, request) => {
    if (path.endsWith('/repository/files/file.bin')) return Response.json({ last_commit_id: parent, blob_id: blob });
    if (path.endsWith('/repository/commits') && request.method === 'POST') {
      body = JSON.parse(request.body);
      return Response.json({ id: next, parent_ids: [parent] }, { status: 201 });
    }
  } });
  const result = await instance.createCommit({ ref: 'main', expectedOid: parent, message: 'Edit',
    files: [{ path: 'file.bin', content }] }, { consistency: 'file' });
  assert.equal(result.consistency, 'file');
  assert.equal(body.actions[0].last_commit_id, parent);
  assert.equal(body.force, false);
});

test('A25 Gitea multi-file commit sends expected blob SHA without forcing the branch', async () => {
  let body;
  const { instance } = transport(fixtures[4], { fetch: async (path, request) => {
    if (path.endsWith('/contents/file.bin')) return Response.json({ sha: blob });
    if (path.endsWith('/contents') && request.method === 'POST') {
      body = JSON.parse(request.body);
      return Response.json({ commit: { sha: next, tree: { sha: tree } } }, { status: 201 });
    }
  } });
  const result = await instance.commitFiles({ ref: 'main', expectedOid: parent, message: 'Edit',
    files: [{ path: 'file.bin', content }] }, { consistency: 'file' });
  assert.equal(result.oid, next);
  assert.equal(result.consistency, 'file');
  assert.deepEqual(body.files[0], { operation: 'update', path: 'file.bin', sha: blob, content: 'AAH+/w==' });
  assert.equal(body.force_push, false);
});

test('A25 Bitbucket source commit preserves multipart binary bytes and declares its non-atomic parent binding', async () => {
  let fields;
  const { instance } = transport(fixtures[2], { fetch: async (path, request) => {
    if (path.endsWith('/src') && request.method === 'POST') {
      fields = await new Request('https://api.bitbucket.org/fixture', { method: 'POST', headers: request.headers,
        body: request.body }).formData();
      return Response.json({ hash: next, parents: [{ hash: parent }] }, { status: 201 });
    }
  } });
  const result = await instance.commitFiles({ ref: 'main', expectedOid: parent, message: 'Edit',
    files: [{ path: 'file.bin', content }] }, { consistency: 'non-atomic-parent' });
  assert.equal(result.oid, next);
  assert.equal(result.consistency, 'non-atomic-parent');
  assert.equal(fields.get('branch'), 'main');
  assert.equal(fields.get('parents'), parent);
  assert.deepEqual(new Uint8Array(await fields.get('/file.bin').arrayBuffer()), content);
});

test('A25 snapshot bounds and path traversal reject hostile provider trees', async () => {
  const { instance } = transport(fixtures[0], { fetch: async path => path.includes('/git/trees/') ?
    Response.json({ tree: [{ path: '../escape', type: 'blob', sha: blob, mode: '100644' }] }) : undefined });
  await assert.rejects(instance.readSnapshot(), { code: 'Unsafe' });
  const bounded = transport(fixtures[0]).instance;
  await assert.rejects(bounded.readSnapshot({ maximumBytes: 3 }), { code: 'Limit' });
  await assert.rejects(bounded.readSnapshot({ maximumFiles: Infinity }), { code: 'Limit' });
  const duplicated = transport(fixtures[0], { fetch: async path => path.includes('/git/trees/') ? Response.json({ tree: [
    { path: 'file.bin', type: 'blob', sha: blob, mode: '100644' }, { path: 'file.bin', type: 'blob', sha: blob, mode: '100644' }
  ] }) : undefined }).instance;
  await assert.rejects(duplicated.readSnapshot(), { code: 'Corrupt' });
});
