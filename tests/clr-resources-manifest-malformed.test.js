import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { manifestImage, manifestContext, openManifest, binaryResource } from './clr-manifest-fixtures.js';

const code = expected => error => error.code === expected;
const embedded = () => manifestImage('Embedded', { resources: [{ name: 'payload', bytes: binaryResource }] });
const linked = (options = {}) => manifestImage('Linked', { files: [{ name: 'payload.bin', bytes: binaryResource }],
  resources: [{ name: 'payload', file: 0 }], ...options });

test('malformed manifest ranges, names, visibility and implementation tags have bounded image diagnostics', async () => {
  const images = [
    manifestImage('Truncated', { resources: [{ name: 'payload', bytes: binaryResource }], decorate: ({ data }) => data.patch32(0, 0xffffffff) }),
    manifestImage('Outside', { resources: [{ name: 'payload', offset: 0xffffffff }] }),
    manifestImage('Name', { resources: [{ name: '', bytes: binaryResource }] }),
    manifestImage('Duplicate', { resources: [{ name: 'x', bytes: binaryResource }, { name: 'x', bytes: binaryResource }] }),
    ...[0, 3, 0x80000001].map(flags => manifestImage('Flags', { resources: [{ name: 'payload', bytes: binaryResource, flags }] })),
    ...[1, 3, 6, 4001].map(implementationRaw => manifestImage('Implementation', { resources: [{ name: 'payload', implementationRaw }] })),
  ];
  for (const image of images) {
    const { reader } = await openManifest(image);
    assert.throws(() => reader.names, code(LoadErrorCode.InvalidImage));
    await assert.rejects(reader.read('payload'), code(LoadErrorCode.InvalidImage));
    reader.dispose();
  }
});

test('invalid File declarations and non-module offsets reject before provider invocation', async () => {
  const cases = [
    { files: [{ name: '../outside.bin', bytes: binaryResource }] },
    { files: [{ name: 'payload.bin', bytes: binaryResource, flags: 2 }] },
    { files: [{ name: 'payload.bin', hashValue: Uint8Array.of(1) }] },
    { hashAlgorithm: 0x7fff },
    { resources: [{ name: 'payload', file: 0, offset: 1 }] },
    { files: [{ name: 'same.bin', bytes: binaryResource }, { name: 'same.bin', bytes: binaryResource }],
      resources: [{ name: 'one', file: 0 }, { name: 'two', file: 1 }] },
  ];
  for (const options of cases) {
    const { reader } = await openManifest(linked(options), { fileProvider: () => { assert.fail('Malformed metadata invoked provider'); } });
    assert.throws(() => reader.names, code(LoadErrorCode.InvalidImage));
    reader.dispose();
  }
  const assemblyBytes = embedded();
  const { reader } = await openManifest(linked({ files: [{ name: 'Wrong.netmodule', bytes: assemblyBytes, containsMetadata: true }] }),
    { fileProvider: () => assemblyBytes });
  await assert.rejects(reader.read('payload'), code(LoadErrorCode.InvalidImage));
  reader.dispose();
});

test('assembly resource cycles report the path, and missing assembly failures stay distinct', async () => {
  const images = new Map(['A', 'B'].map((name, index) => [name, manifestImage(name, { references: [index ? 'A' : 'B'],
    resources: [{ name: 'payload', reference: 0 }] })]));
  const context = manifestContext(images);
  const assembly = await context.loadFromAssemblyName('A');
  await assert.rejects(assembly.openManifestResources().read('payload'), error =>
    error.code === LoadErrorCode.RecursiveResolution && /A\/A.dll -> B\/B.dll -> A\/A.dll/.test(error.message));
  const missing = await openManifest(manifestImage('Missing', { references: ['Absent'], resources: [{ name: 'payload', reference: 0 }] }));
  await assert.rejects(missing.reader.read('payload'), code(LoadErrorCode.MissingAssembly));
  missing.reader.dispose();
});

test('linked module offsets and length prefixes are bounded without a fallback to the child resource name', async () => {
  for (const [offset, corrupt] of [[4, false], [0xffffffff, false], [0, true]]) {
    const module = manifestImage('Child', { netmodule: true, resources: [{ name: 'payload', bytes: binaryResource }],
      decorate: ({ data }) => { if (corrupt) data.patch32(0, 0xffffffff); } });
    const owner = manifestImage('Owner', { files: [{ name: 'Child.netmodule', bytes: module, containsMetadata: true }],
      resources: [{ name: 'payload', file: 0, offset }] });
    const { reader } = await openManifest(owner, { fileProvider: () => module });
    await assert.rejects(reader.read('payload'), code(LoadErrorCode.InvalidImage));
    await assert.rejects(reader.getInfo('payload'), code(LoadErrorCode.InvalidImage));
    reader.dispose();
  }
});

test('all declared file hash algorithms match independent Node hashes, including MD5 padding boundaries', async () => {
  for (const hashAlgorithm of [0, 0x8003, 0x8004, 0x800c, 0x800d, 0x800e]) {
    for (const length of hashAlgorithm === 0x8003 ? [0, 1, 3, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000] : [57]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 17 + length) & 255);
      const image = manifestImage('Hash', { hashAlgorithm, files: [{ name: 'hash.bin', bytes }], resources: [{ name: 'payload', file: 0 }] });
      const { reader } = await openManifest(image, { fileProvider: () => bytes });
      assert.deepEqual(await reader.read('payload'), bytes, `algorithm=${hashAlgorithm}, length=${length}`);
      reader.dispose();
    }
  }
  let corrupt = true;
  const { reader } = await openManifest(linked(), { maxCachedFileBytes: binaryResource.length,
    fileProvider: () => corrupt ? Uint8Array.of(1, 2, 3, 4) : binaryResource });
  await assert.rejects(reader.read('payload'), code(LoadErrorCode.FileLoad));
  corrupt = false;
  assert.deepEqual(await reader.read('payload'), binaryResource, 'Failed hash verification must release its byte reservation');
  reader.dispose();
});

test('resource, directory, metadata and owned file budgets hold at exact boundaries', async () => {
  const image = embedded();
  const { assembly } = await openManifest(image);
  for (const options of [{ maxResources: 0 }, { maxNameBytes: 6 }, { maxMetadataCharacters: 6 }, { maxDirectoryBytes: 7 }]) {
    assert.throws(() => assembly.openManifestResources(options).names, code(LoadErrorCode.LimitExceeded));
  }
  const exact = assembly.openManifestResources({ maxResources: 1, maxNameBytes: 7, maxMetadataCharacters: 7,
    maxDirectoryBytes: 8, maxResourceBytes: 4, maxSources: 1, maxHops: 0 });
  assert.deepEqual(await exact.read('payload'), binaryResource);
  await assert.rejects(assembly.openManifestResources({ maxResourceBytes: 3 }).read('payload'), code(LoadErrorCode.LimitExceeded));
  const unicode = await openManifest(manifestImage('Unicode', { resources: [{ name: 'ż', bytes: binaryResource }] }), { maxNameBytes: 1 });
  assert.throws(() => unicode.reader.names, code(LoadErrorCode.LimitExceeded));
  const empty = await openManifest(manifestImage('NoResources'), { maxNameBytes: 3 });
  assert.equal(await empty.reader.read('ż'), null);
  await assert.rejects(empty.reader.read('😃'), code(LoadErrorCode.LimitExceeded));
  empty.reader.dispose();
  for (const options of [null, [], { maxSources: 0 }, { maxHops: 1025 }, { maxResources: 65536 },
    { maxResourceBytes: -1 }, { maxFileBytes: 128 * 1024 * 1024 + 1 }, { maxNameBytes: NaN }, { fileProvider: 1 }]) {
    assert.throws(() => assembly.openManifestResources(options), code(LoadErrorCode.InvalidConfiguration));
  }
  for (const options of [{ maxResourceBytes: 3 }, { maxFileBytes: 3 }, { maxCachedFileBytes: 3 }, { maxFiles: 0 }, { maxPendingFiles: 0 }]) {
    const current = await openManifest(linked(), { fileProvider: () => binaryResource, ...options });
    await assert.rejects(current.reader.read('payload'), code(LoadErrorCode.LimitExceeded));
    current.reader.dispose();
  }
  class SpoofedBytes extends Uint8Array { get byteLength() { return 0; } get length() { return 0; } }
  const spoofed = await openManifest(linked(), { fileProvider: () => new SpoofedBytes(binaryResource), maxFileBytes: 3 });
  await assert.rejects(spoofed.reader.read('payload'), code(LoadErrorCode.LimitExceeded));
  const buffer = new ArrayBuffer(4);
  structuredClone(buffer, { transfer: [buffer] });
  const detached = await openManifest(linked(), { fileProvider: () => buffer });
  await assert.rejects(detached.reader.read('payload'), code(LoadErrorCode.InvalidImage));
  exact.dispose();
});

test('missing or unsupported Web Crypto is explicit and a failed hash backend releases its reservation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const { reader } = await openManifest(linked({ hashAlgorithm: 0x800d }), { fileProvider: () => binaryResource,
    maxCachedFileBytes: binaryResource.length });
  try {
    for (const value of [undefined, { subtle: { digest() { throw new DOMException('Fixture backend', 'NotSupportedError'); } } }]) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
      await assert.rejects(reader.read('payload'), code(LoadErrorCode.UnsupportedFeature));
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
  assert.deepEqual(await reader.read('payload'), binaryResource);
  reader.dispose();
});

test('cache byte exhaustion leaves successful files usable and provider failures remain retryable', async () => {
  const image = manifestImage('TwoFiles', { files: [{ name: 'one.bin', bytes: binaryResource }, { name: 'two.bin', bytes: binaryResource }],
    resources: [{ name: 'one', file: 0 }, { name: 'two', file: 1 }] });
  const { reader } = await openManifest(image, { fileProvider: () => binaryResource, maxCachedFileBytes: 7 });
  assert.deepEqual(await reader.read('one'), binaryResource);
  await assert.rejects(reader.read('two'), code(LoadErrorCode.LimitExceeded));
  assert.deepEqual(await reader.read('one'), binaryResource);
  let fail = true;
  const retry = await openManifest(linked(), { fileProvider: () => { if (fail) throw new Error('Fixture I/O failure'); return binaryResource; } });
  await assert.rejects(retry.reader.read('payload'), error => error.code === LoadErrorCode.FileLoad && /Fixture I\/O failure/.test(error.message));
  fail = false;
  assert.deepEqual(await retry.reader.read('payload'), binaryResource);
  for (const reason of [null, undefined, 'plain rejection', 13]) {
    const rejected = await openManifest(linked(), { fileProvider: () => Promise.reject(reason) });
    await assert.rejects(rejected.reader.read('payload'), code(LoadErrorCode.FileLoad));
    rejected.reader.dispose();
  }
  reader.dispose();
  retry.reader.dispose();
});

test('pending file work is bounded and cancellation/disposal never publish late provider bytes', async () => {
  let complete;
  let receivedSignal;
  const pending = await openManifest(linked(), { maxPendingFiles: 1,
    fileProvider: request => { receivedSignal = request.signal; return new Promise(resolve => { complete = resolve; }); } });
  const controller = new AbortController();
  const first = pending.reader.read('payload', { signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
  await assert.rejects(pending.reader.read('payload'), code(LoadErrorCode.LimitExceeded));
  controller.abort();
  complete(binaryResource);
  await assert.rejects(first, code(LoadErrorCode.Cancelled));
  const retry = pending.reader.read('payload');
  complete(binaryResource);
  assert.deepEqual(await retry, binaryResource);
  const disposed = await openManifest(linked(), { fileProvider: () => new Promise(resolve => { complete = resolve; }) });
  const late = disposed.reader.read('payload');
  disposed.reader.dispose();
  complete(binaryResource);
  await assert.rejects(late, code(LoadErrorCode.Disposed));
  pending.reader.dispose();
});
