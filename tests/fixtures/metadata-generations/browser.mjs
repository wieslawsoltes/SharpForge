import { MetadataGenerations, readMetadata } from '@sharpforge/cil';
import { replayMetadataGenerations } from './replay.mjs';

const corpus = new URL('./reference/', import.meta.url), original = new URL('../portable-pdb-generations/', import.meta.url);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
function assert(value, label) { if (!value) throw new Error(label); }
function equal(actual, expected, label) { assert(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), label); }
function rejects(action, code) {
  let failure;
  try { action(); } catch (error) { failure = error; }
  equal(failure?.code, code, 'Expected rejection: ' + code);
}
async function request(base, path) {
  const response = await fetch(new URL(path, base));
  assert(response.ok, 'Native fixture request failed: ' + path);
  return response;
}
async function input(base, artifact) {
  const bytes = new Uint8Array(await (await request(base, artifact.name)).arrayBuffer());
  equal(bytes.length, artifact.bytes, 'Native artifact byte length');
  equal(hex(await crypto.subtle.digest('SHA-256', bytes)), artifact.sha256, 'Native artifact SHA-256');
  return bytes;
}

function boundaries(inputs) {
  const bytes = inputs[0].slice(), reader = new MetadataGenerations(bytes, { format: 'pe' });
  const baselineRow = reader.row(0x06000001);
  bytes.fill(0);
  equal(reader.row(0x06000001), baselineRow, 'Owned baseline after input mutation');
  const malformed = inputs[1].slice(), metadata = readMetadata(malformed);
  new DataView(malformed.buffer).setUint32(metadata.tableOffset + metadata.rowOffsets[31][0], 0, true);
  rejects(() => reader.append(malformed, { generation: 1 }), 'MD_GEN_MAP');
  rejects(() => reader.append(inputs[1], { generation: 2 }), 'MD_GEN_IDENTITY');
  rejects(() => reader.append(inputs[1], { generation: 1, signal: AbortSignal.abort() }), 'MD_GEN_CANCELED');
  equal(reader.generation, 0, 'Rejected append leaves the baseline intact');
  const options = { get generation() {
    rejects(() => reader.append(inputs[1], { generation: 1 }), 'MD_GEN_INPUT');
    equal(reader.generation, 0, 'Option getter cannot publish a nested append');
    return 1;
  } };
  reader.append(inputs[1], options);
  reader.append(inputs[2], { generation: 2 });
  rejects(() => reader.rows(6, { maxPageBytes: 0 }), 'MD_GEN_BUDGET');
  rejects(() => reader.heapEntry('#GUID', 1, { maxEntryBytes: 15 }), 'MD_GEN_BUDGET');
  const row = reader.row(0x06000001), originalValues = [...row.values];
  row.values.fill(0);
  equal(reader.row(0x06000001).values, originalValues, 'Owned row projection');
  equal(reader.row(0x06000001, { generation: 0 }), baselineRow, 'Historical baseline row');
  reader.dispose();
  equal(baselineRow.values.length > 0, true, 'Returned rows survive disposal');
  rejects(() => reader.rows(6), 'MD_GEN_DISPOSED');
  const bounded = new MetadataGenerations(inputs[0], { format: 'pe', maxGenerations: 1 });
  rejects(() => bounded.append(inputs[1], { generation: 1 }), 'MD_GEN_BUDGET');
  bounded.dispose();
}

/** Browser source-module replay of retained native evidence; never launches managed code. */
export async function run() {
  const reference = await (await request(corpus, 'native.json')).json();
  equal(reference.status, 'native-and-node-replay-completed', 'Complete native capture');
  const reports = {};
  for (const [name, native] of Object.entries(reference.corpora)) {
    const base = name === 'original' ? original : new URL('./mixed/', corpus);
    const inputs = await Promise.all(native.artifacts.map(artifact => input(base, artifact)));
    const replay = replayMetadataGenerations(native, inputs, equal);
    equal(replay.totals, native.replay, 'Native coverage counts: ' + name);
    reports[name] = replay.totals;
    replay.reader.dispose();
    boundaries(inputs);
  }
  equal(Object.keys(reports).sort(), ['mixed', 'original'], 'Both native corpora');
  return { passed: true, checks: ['Hashed real Roslyn baseline and two deltas for both corpora',
    'SRM row scalars and references, MetadataAggregator mappings, heaps and historical rows',
    'Owned input/row values, malformed maps, ordinal mismatch, reentrancy, bounds, cancellation and disposal'],
  reports, nativeReference: { sourceCommit: reference.sourceCommit, toolchain: reference.toolchain },
  nativeInvocation: false, managedApplyUpdate: false };
}
