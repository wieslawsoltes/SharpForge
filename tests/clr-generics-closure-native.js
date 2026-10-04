import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const fixture = process.env.SHARPFORGE_GENERIC_CLOSURE_FIXTURES
  ? pathToFileURL(process.env.SHARPFORGE_GENERIC_CLOSURE_FIXTURES + '/') : new URL('./fixtures/clr-generic-closure/', import.meta.url);
const evidence = process.env.SHARPFORGE_GENERIC_CLOSURE_EVIDENCE
  ? pathToFileURL(process.env.SHARPFORGE_GENERIC_CLOSURE_EVIDENCE + '/') : new URL('qualification-capture/', fixture);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async url => JSON.parse(await readFile(url, 'utf8'));
const capturedName = path => path.replaceAll('\\', '/').split('/').pop();

async function verify(url, expected) {
  const bytes = await readFile(url);
  assert.equal(bytes.length, expected.bytes, String(url));
  assert.equal(digest(bytes), expected.sha256, String(url));
  return bytes;
}

export async function readNativeClosure() {
  const status = await json(new URL('capture-status.json', evidence));
  assert.equal(status.status, 'completed');
  assert.equal(status.steps.length, 40);
  const nativeBytes = await verify(new URL('native-closure.json', fixture), status.result);
  const native = JSON.parse(nativeBytes.toString('utf8'));
  assert.equal(native.schemaVersion, 1);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.deepEqual(native.counts, { cases: 34, operations: 71, identities: 38, images: 14 });
  assert.deepEqual(status.counts, native.counts);
  assert.deepEqual(status.sources, native.sources);
  assert.deepEqual(status.productSources, native.productSources);
  assert.equal(native.sources.length, 12);
  assert.equal(new Set(native.sources.map(source => source.path)).size, 12);
  for (const source of native.sources) {
    assert.match(source.path, /^packages\/clr\/(?:interop\/Generic(?:Closure|Instantiation)\/[A-Za-z0-9.-]+|tools\/capture-generic-closure\.mjs)$/);
    await verify(new URL(source.path, root), source);
    await verify(new URL('workspace/source/' + source.path, evidence), source);
  }
  const pin = await json(new URL('packages/clr/interop/GenericClosure/oracle-toolchain.json', root));
  assert.equal(native.toolchain.compiler.sha256, pin.roslyn.platformHashes[`${native.platform}-${native.architecture}`]);
  assert.equal(native.toolchain.referencePack, '10.0.5');
  assert.equal(native.toolchain.referenceAssemblies.length, 167);
  assert.equal(digest(JSON.stringify(native.toolchain.referenceAssemblies)), pin.referenceAssemblies.sha256);
  assert.equal(digest(await readFile(new URL('capture-inputs.json', evidence))), native.captureInputsSha256);
  await verify(new URL('workspace/images/GenericClosureOracle.dll', evidence), native.observer);
  await verify(new URL('workspace/pinned.runtimeconfig.json', evidence), native.runtimeConfig);
  const images = new Map();
  assert.equal(native.images.length, 14);
  for (const image of native.images) {
    assert.match(image.file, /^[A-Za-z0-9._-]+\.dll$/);
    assert.equal(images.has(image.id), false);
    images.set(image.id, new Uint8Array(await verify(new URL(image.file, fixture), image)));
  }
  assert.equal(native.cases.length, 34);
  const matrix = await json(new URL('packages/clr/interop/GenericClosure/matrix.json', root));
  assert.deepEqual(native.cases.map(item => item.id), matrix.cases.map(item => item.id));
  const rawCases = [];
  for (let index = 0; index < status.steps.length; index++) {
    const step = status.steps[index];
    assert.equal(step.status, 'exited');
    assert.equal(step.exitCode, 0);
    assert.equal(step.signal, null);
    assert.equal(step.error, null);
    const output = await verify(new URL(capturedName(step.stdout.path), evidence), step.stdout);
    await verify(new URL(capturedName(step.stderr.path), evidence), step.stderr);
    if (index === 5) assert.deepEqual(JSON.parse(output.toString('utf8')).observations.metadata, native.metadata);
    if (index >= 6) rawCases.push(JSON.parse(output.toString('utf8')).observations);
  }
  assert.deepEqual(native.cases, rawCases, 'Every native result remains byte-derived from its isolated observer output');
  for (const item of native.cases) {
    const name = item.id + '.jsonl';
    const records = status.retainedFiles.filter(record => capturedName(record.path) === name);
    assert.equal(records.length, 1, 'Each isolated case retains exactly one progress journal');
    const bytes = await verify(new URL('workspace/progress/' + name, evidence), records[0]);
    const events = bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(events.at(-1).event, 'case-completed');
    assert.deepEqual(events.at(-1).observation, item);
  }
  return { native, images };
}
