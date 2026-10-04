import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readZip } from '@sharpforge/archive';
import { MemoryStore } from '../packages/git/src/storage/memory-store.js';
import { ObjectDatabase } from '../packages/git/src/odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { encodeTree, encodeCommit } from '../packages/git/src/objects.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { writePackIndex } from '../packages/git/src/pack/index.js';
import { createPackReader } from '../packages/git/src/pack/accessor.js';
import { bytesToHex } from '../packages/git/src/object-format.js';
import { hashObject } from '../packages/git/src/hash.js';
import { exportTreeZip, importBundle, readBundle } from '../packages/git/src/archive.js';
import { gcRepository, repositoryStorageUsage } from '../packages/git/src/maintenance.js';
import { concatBytes } from '../packages/git/src/protocol/bytes.js';

const encode = value => new TextEncoder().encode(value);
const identity = { name: 'Fixture', email: 'fixture@example.test', timestamp: 1000, timezone: '+0000' };

function repo(algorithm = 'sha1') {
  const store = new MemoryStore();
  return { store, odb: new ObjectDatabase({ store, algorithm }), refs: new RefDatabase({ store, algorithm }), algorithm };
}

test('tree ZIP export honors in-tree export-ignore and exports a commit snapshot', async () => {
  const repository = repo();
  const { odb } = repository;
  const blob = async value => odb.write('blob', encode(value));
  const secret = await odb.write('tree', encodeTree([{ name: 'key.txt', mode: 0o100644, oid: await blob('secret') }]));
  const tree = await odb.write('tree', encodeTree([
    { name: '.gitattributes', mode: 0o100644, oid: await blob('ignored.txt export-ignore\nsecret export-ignore\n') },
    { name: 'README.md', mode: 0o100644, oid: await blob('readme') },
    { name: 'ignored.txt', mode: 0o100644, oid: await blob('ignore') },
    { name: 'secret', mode: 0o40000, oid: secret }
  ]));
  const commit = await odb.write('commit', encodeCommit({ tree, parents: [], author: identity, committer: identity, message: 'archive' }));
  const result = await exportTreeZip({ ...repository, oid: commit });
  assert.deepEqual(readZip(result.bytes).map(file => file.path), ['.gitattributes', 'README.md']);
  await assert.rejects(exportTreeZip({ ...repository, oid: commit, maxTotalBytes: 1 }), { code: 'Limit' });
});

test('bundle v2/v3 streams clone offline, negotiate format and reject unavailable prerequisites', async () => {
  for (const algorithm of ['sha1', 'sha256']) {
    const repository = repo(algorithm);
    const data = encode('offline object');
    const oid = await hashObject('blob', data, { algorithm });
    const { pack } = await writePack([{ type: 'blob', data }], { algorithm });
    const header = algorithm === 'sha1' ? `# v2 git bundle\n${oid} refs/tags/offline\n\n` :
      `# v3 git bundle\n@object-format=sha256\n${oid} refs/tags/offline\n\n`;
    const bytes = concatBytes([encode(header), pack]);
    const stream = (async function* () { for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7); })();
    const result = await importBundle(stream, repository);
    assert.equal(result.algorithm, algorithm);
    assert.equal(await repository.refs.read('refs/tags/offline'), oid);
    assert.deepEqual((await repository.odb.read(oid)).data, data);
    const missing = '1'.repeat(algorithm === 'sha1' ? 40 : 64);
    const version = algorithm === 'sha1' ? '# v2 git bundle\n' : '# v3 git bundle\n@object-format=sha256\n';
    await assert.rejects(importBundle(concatBytes([encode(`${version}-${missing} prerequisite\n${oid} refs/tags/test\n\n`), pack]), repo(algorithm)),
      { code: 'NotFound' });
  }
  await assert.rejects(readBundle(encode('# v3 git bundle\n@unknown=required\n\nPACK')), { code: 'Unsupported' });
});

test('50 installed packs consolidate to one while preserving reachable IDs and pruning only old unreachable objects', async () => {
  const repository = repo();
  const reachable = [];
  for (let iteration = 0; iteration < 50; iteration++) {
    const data = encode(`fixture ${iteration} ${'common text '.repeat(200)}`);
    const oid = await repository.odb.write('blob', data);
    reachable.push(oid);
    await repository.refs.update(`refs/tags/item-${iteration}`, oid);
    const encoded = await writePack([{ type: 'blob', data }]);
    const checksum = bytesToHex(encoded.pack.subarray(-20));
    const index = await writePackIndex(encoded.entries, checksum);
    await repository.store.installPack({ id: checksum, pack: encoded.pack, index });
    repository.odb.addPackReader(await createPackReader({ pack: encoded.pack, index }));
  }
  const unreachable = await repository.odb.write('blob', encode('old unreachable'));
  const before = await repositoryStorageUsage(repository);
  assert.equal(before.packs, 50);
  const result = await gcRepository({ ...repository, now: 1000, graceSeconds: 100, objectTimestamp: async () => 1 });
  assert.equal(result.after.packs, 1);
  assert.ok(result.after.totalBytes < before.totalBytes);
  assert.deepEqual((await repository.odb.list()).sort(), reachable.sort());
  assert.deepEqual(result.pruned, [unreachable]);
  for (const oid of reachable) assert.equal(await repository.odb.has(oid), true);
});

test('native Git-produced bundle imports and ZIP export listing agrees with git archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-bundle-'));
  try {
    execFileSync('git', ['init', '-b', 'main', directory], { stdio: 'pipe' });
    await writeFile(join(directory, 'README.md'), 'reference\n');
    await writeFile(join(directory, 'private.txt'), 'private\n');
    await writeFile(join(directory, '.gitattributes'), 'private.txt export-ignore\n');
    execFileSync('git', ['-C', directory, 'add', '.']);
    execFileSync('git', ['-C', directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'reference'], { stdio: 'pipe' });
    const bundlePath = join(directory, 'all.bundle');
    execFileSync('git', ['-C', directory, 'bundle', 'create', bundlePath, '--all']);
    const repository = repo();
    await importBundle(new Uint8Array(await readFile(bundlePath)), repository);
    const oid = await repository.refs.read('refs/heads/main');
    const ours = await exportTreeZip({ ...repository, oid });
    const native = execFileSync('git', ['-C', directory, 'archive', '--format=zip', 'HEAD']);
    assert.deepEqual(readZip(ours.bytes).map(entry => entry.path), readZip(new Uint8Array(native)).map(entry => entry.path));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
