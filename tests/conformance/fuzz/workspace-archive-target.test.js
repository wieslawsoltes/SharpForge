import test from 'node:test';
import assert from 'node:assert/strict';
import { writeZip } from '@sharpforge/archive';
import { WORKSPACE_MANIFEST, writeNewDirectory } from '@sharpforge/project-system';
import { target } from '../../../scripts/conformance/fuzz/targets/zip-archive.js';
import { importZipIntoMemory } from '../../../scripts/conformance/fuzz/targets/binary-workspace-import.js';
import { workspaceArchiveSeeds } from '../../../scripts/conformance/fuzz/targets/binary-workspace-seeds.js';
import { workspaceImportFailure } from '../../../scripts/conformance/fuzz/targets/binary-workspace-errors.js';
import {
  BinaryDestinationError, MEMORY_DESTINATION_ROOT, createMemoryDestination,
} from '../../../scripts/conformance/fuzz/targets/binary-memory-destination.js';

const context = overrides => Object.freeze({ maxInputBytes: 65536, maxOutputBytes: 65536, ...overrides });
const archiveLimits = Object.freeze({
  maxArchiveBytes: 65536, maxEntries: 32, maxFileBytes: 65536, maxTotalBytes: 65536, maxPathLength: 128, maxDepth: 8,
});

function manifest(settings = {}, records = []) {
  return writeZip([
    ...records,
    { path: WORKSPACE_MANIFEST, text: JSON.stringify({ format: 'sharpforge-workspace', version: 1, ...settings }) },
  ]);
}

test('workspace ZIP import and actual destination writer preserve source, binary, UTF-16 and manifest root', async () => {
  for (const seed of workspaceArchiveSeeds()) {
    const before = seed.input.slice();
    const result = await importZipIntoMemory(seed.input, archiveLimits);
    assert.equal(result.failure, undefined);
    assert.equal(result.manifest, true);
    assert.equal(result.settings.entry, 'Sample.csproj');
    assert.equal(result.settings.startup, 'Sample.csproj');
    const files = new Map(result.snapshot.files.map(file => [file.path, file.bytes]));
    assert.deepEqual([...files.keys()], [
      `${MEMORY_DESTINATION_ROOT}/Assets/pixel.bin`, `${MEMORY_DESTINATION_ROOT}/Notes.md`,
      `${MEMORY_DESTINATION_ROOT}/Program.cs`, `${MEMORY_DESTINATION_ROOT}/Sample.csproj`,
    ]);
    assert.deepEqual(files.get(`${MEMORY_DESTINATION_ROOT}/Assets/pixel.bin`), new Uint8Array([0, 255, 128, 1]));
    assert.deepEqual(files.get(`${MEMORY_DESTINATION_ROOT}/Notes.md`), new Uint8Array([255, 254, 123, 1, 243, 0, 66, 1, 7, 1, 10, 0]));
    assert(result.snapshot.folders.includes(`${MEMORY_DESTINATION_ROOT}/Empty`));
    assert(result.snapshot.files.every(file => file.path.startsWith(`${MEMORY_DESTINATION_ROOT}/`)));
    assert.deepEqual(seed.input, before);
  }
});

test('workspace ZIP target awaits actual import/write completion and preserves cancellation', async () => {
  const input = workspaceArchiveSeeds()[0].input;
  assert.deepEqual(await target.run(input, context()), { status: 'accepted', code: 'ZIP_WORKSPACE_IMPORTED_IN_MEMORY' });
  const controller = new AbortController();
  const pending = target.run(input, context({ signal: controller.signal }));
  controller.abort();
  assert.equal((await pending).code, 'FUZZ_CANCELLED');
});

test('workspace ZIP rejects ambiguous manifests and files outside the selected manifest root', async () => {
  const settings = JSON.stringify({ format: 'sharpforge-workspace', version: 1 });
  const ambiguous = writeZip([
    { path: WORKSPACE_MANIFEST, text: settings }, { path: `nested/${WORKSPACE_MANIFEST}`, text: settings },
  ]);
  assert.match((await target.run(ambiguous, context())).detail, /Multiple workspace manifests/);
  const outside = writeZip([
    { path: `repository/${WORKSPACE_MANIFEST}`, text: settings }, { path: 'outside.txt', text: 'bounded' },
  ]);
  const result = await importZipIntoMemory(outside, archiveLimits);
  assert.equal(result.failure.code, 'WORKSPACE_VALIDATION');
  assert.match(result.failure.detail, /outside the manifest root/);
  assert.equal(result.snapshot, undefined);
});

test('workspace manifest parsing distinguishes malformed JSON, UTF-8 and settings validation', async () => {
  const malformed = writeZip([{ path: WORKSPACE_MANIFEST, text: '{' }]);
  assert.equal((await target.run(malformed, context())).code, 'WORKSPACE_MANIFEST_JSON');
  const invalidUtf8 = writeZip([{ path: WORKSPACE_MANIFEST, bytes: new Uint8Array([255]) }]);
  assert.equal((await target.run(invalidUtf8, context())).code, 'WORKSPACE_MANIFEST_UTF8');
  assert.equal((await target.run(manifest({ name: [] }), context())).code, 'WORKSPACE_VALIDATION');
  assert.equal((await target.run(manifest({ startupConfiguration: { version: 2 } }), context())).code, 'WORKSPACE_VALIDATION');
  const badComputeMetadata = manifest({ launchProfiles: { version: 1, projects: [{
    projectId: 'Sample.csproj', profiles: [{ id: 'default', compute: { workers: 0 } }],
  }] } }, [{ path: 'Sample.csproj', text: '<Project />' }]);
  assert.equal((await target.run(badComputeMetadata, context())).code, 'WORKSPACE_VALIDATION');
});

test('workspace manifest traversal is bounded before recursive settings projection', async () => {
  let nested = null;
  for (let depth = 0; depth < 34; depth++) nested = { child: nested };
  const result = await target.run(manifest({ ignored: nested }), context());
  assert.equal(result.code, 'FUZZ_JSON_LIMIT');
});

test('tiny compressed input with an oversized declaration rejects before destination creation', async () => {
  const input = target.createSeeds().find(seed => seed.name === 'small-deflate').input.slice();
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const central = view.getUint32(input.length - 6, true);
  view.setUint32(22, 15, true);
  view.setUint32(central + 24, 15, true);
  const result = await importZipIntoMemory(input, { ...archiveLimits, maxFileBytes: 14, maxTotalBytes: 14 });
  assert.equal(result.failure.code, 'ZIP_VALIDATION');
  assert.match(result.failure.detail, /Uncompressed archive size limit/);
  assert.equal(result.snapshot, undefined);
});

test('workspace ZIP enforces aggregate decode bytes, entry count and path depth', async () => {
  const aggregate = writeZip([{ path: 'a.txt', text: 'first' }, { path: 'b.txt', text: 'other' }]);
  assert.equal((await target.run(aggregate, context({ maxOutputBytes: 9 }))).code, 'ZIP_VALIDATION');
  const many = writeZip(Array.from({ length: 33 }, (_, index) => ({ path: `${index}.txt`, text: '' })));
  assert.equal((await target.run(many, context())).code, 'ZIP_VALIDATION');
  const deep = writeZip([{ path: 'a/b/c/d/e/f/g/h/i.txt', text: 'small' }]);
  assert.equal((await target.run(deep, context())).code, 'ZIP_VALIDATION');
});

test('actual destination writer rejects traversal and colliding plans before mutating its memory root', async () => {
  for (const paths of [['../escape.txt'], ['a.txt', 'a.txt'], ['A/one.txt', 'a/two.txt']]) {
    const destination = createMemoryDestination();
    await assert.rejects(() => writeNewDirectory(destination.root, { records: paths.map(path => ({ path, text: 'small' })) }));
    assert.deepEqual(destination.snapshot(), { files: [], folders: [], bytes: 0 });
  }
});

test('memory destination exposes only child handles and independently bounds actual writer output', async () => {
  const destination = createMemoryDestination({ maxFileBytes: 3, maxTotalBytes: 3 });
  for (const name of ['..', '../other', '/absolute', 'C:drive', 'folder\\child']) {
    await assert.rejects(() => destination.root.getDirectoryHandle(name, { create: true }), BinaryDestinationError);
  }
  await assert.rejects(() => writeNewDirectory(destination.root, { records: [{ path: 'a.txt', text: 'four' }] }), error => {
    assert.equal(error.name, 'BinaryDestinationError');
    assert(error.cause instanceof BinaryDestinationError);
    assert.deepEqual(error.written, []);
    return true;
  });
  assert.deepEqual(destination.snapshot(), {
    files: [{ path: `${MEMORY_DESTINATION_ROOT}/a.txt`, bytes: new Uint8Array() }], folders: [], bytes: 0,
  });
});

test('memory destination verifies non-atomic writer failure and owns committed bytes', async () => {
  const destination = createMemoryDestination({ maxEntries: 1 });
  await assert.rejects(() => writeNewDirectory(destination.root, {
    records: [{ path: 'a.txt', text: 'one' }, { path: 'b.txt', text: 'two' }],
  }), error => {
    assert.equal(error.name, 'BinaryDestinationError');
    assert.deepEqual(error.written, ['a.txt']);
    return true;
  });
  const first = destination.snapshot();
  assert.equal(first.files.length, 1);
  assert.equal(first.files[0].path, `${MEMORY_DESTINATION_ROOT}/a.txt`);
  first.files[0].bytes.fill(0);
  assert.deepEqual(destination.snapshot().files[0].bytes, new TextEncoder().encode('one'));
});

test('workspace import preserves unknown parser and destination exceptions as findings', () => {
  for (const error of [new Error('Unexpected invariant'), new TypeError('Unexpected metadata shape'),
    new RangeError('Unexpected native allocation'), new BinaryDestinationError('Writer escaped its root')]) {
    assert.throws(() => workspaceImportFailure(error), thrown => thrown === error);
  }
});
