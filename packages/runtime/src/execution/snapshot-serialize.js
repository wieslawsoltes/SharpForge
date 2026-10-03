import {validateSnapshotState} from '../snapshot-validation.js';
import {validateGenericInstantiations} from './generics.js';
import {encodeSnapshotGraph, decodeSnapshotGraph} from './snapshot-wire-graph.js';
import {SnapshotFormatError, snapshotFormatError, snapshotLimits} from './snapshot-wire-values.js';
import {snapshotSchemaVersion} from './snapshot-version.js';

export const portableSnapshotVersion = 1;

function imageText(image) {
  const {il, ...code} = image;
  // Assembly-loader timings describe a load, not executable code identity.
  return JSON.stringify(code, (_key, value) => {
    if (typeof value === 'bigint') return {$integer: value.toString()};
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
      return {$number: Object.is(value, -0) ? '-0' : String(value)};
    }
    if (ArrayBuffer.isView(value)) return {$view: value.constructor.name, values: [...value]};
    return value;
  });
}

async function codeIdentity(vm) {
  if (!globalThis.crypto?.subtle) snapshotFormatError('SNAPSHOT_CRYPTO', 'Portable snapshots require Web Crypto SHA-256');
  const bytes = vm.inspector?.pe.bytes ?? new TextEncoder().encode(imageText(vm.image));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

function jsonBytes(value, maximum) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > maximum) {
    snapshotFormatError('SNAPSHOT_LIMIT', 'Portable snapshot byte limit exceeded');
  }
  return text;
}

/** Export a JSON/structured-clone safe graph tied to exact code bytes and ABI. */
export async function serializeSnapshot(vm, snapshot = vm.snapshot(), options = {}) {
  const limits = snapshotLimits(options);
  if (snapshot?.owner !== vm.snapshotOwner || snapshot.codeOwner !== (vm.inspector ?? vm.image)) {
    snapshotFormatError('SNAPSHOT_OWNER', 'Snapshot belongs to another VM or code generation');
  }
  vm.platform.hostOperations.checkRestore(snapshot.hostRevision);
  const graph = encodeSnapshotGraph(vm, snapshot, limits);
  const identity = await codeIdentity(vm);
  if (snapshot.codeOwner !== (vm.inspector ?? vm.image)) snapshotFormatError('SNAPSHOT_CODE', 'Code changed during snapshot export');
  vm.platform.hostOperations.checkRestore(snapshot.hostRevision);
  const wire = {
    format: 'SharpForge.snapshot', version: portableSnapshotVersion, schemaVersion: snapshot.schemaVersion,
    engine: snapshot.engine, codeIdentity: identity, nativeIntBits: vm.heap.methodTables.nativeIntBits,
    hostRevision: snapshot.hostRevision, entryToken: vm.entryToken ?? vm.report?.entryPoint ?? null, graph
  };
  const text = jsonBytes(wire, limits.maxBytes);
  return options.json ? text : wire;
}

function readPayload(payload, limits) {
  if (typeof payload !== 'string') {
    assertWireTree(payload, limits);
    return JSON.parse(jsonBytes(payload, limits.maxBytes));
  }
  if (new TextEncoder().encode(payload).byteLength > limits.maxBytes) {
    snapshotFormatError('SNAPSHOT_LIMIT', 'Portable snapshot byte limit exceeded');
  }
  try {
    return JSON.parse(payload);
  } catch (error) {
    snapshotFormatError('SNAPSHOT_JSON', 'Invalid portable snapshot JSON: ' + error.message);
  }
}

function assertWireTree(root, limits) {
  const pending = [[root, 0]];
  const seen = new Set();
  let items = 0;
  let bytes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++items > limits.maxItems || depth > 128) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot JSON nesting limit exceeded');
    if (typeof value === 'string') {
      bytes += value.length * 2;
      if (bytes > limits.maxBytes) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot JSON string limit exceeded');
    } else if (value !== null && typeof value === 'object') {
      if (seen.has(value)) snapshotFormatError('SNAPSHOT_JSON', 'Wire aliases must use numbered graph references');
      seen.add(value);
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        snapshotFormatError('SNAPSHOT_JSON', 'Wire objects must be plain JSON records');
      }
      for (const key of Object.keys(value)) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(property, 'value')) snapshotFormatError('SNAPSHOT_JSON', 'Wire accessors are not supported');
        pending.push([property.value, depth + 1]);
      }
    } else if (value !== null && typeof value !== 'boolean'
        && !(typeof value === 'number' && Number.isFinite(value))) {
      snapshotFormatError('SNAPSHOT_JSON', 'Wire values must be JSON scalars');
    }
  }
}

/** Rebind all owned identities to a fresh VM; restore performs graph preflight. */
export async function deserializeSnapshot(vm, payload, options = {}) {
  const limits = snapshotLimits(options);
  const wire = readPayload(payload, limits);
  const engine = vm.inspector ? 'cil' : 'source';
  if (wire?.format !== 'SharpForge.snapshot' || wire.version !== portableSnapshotVersion || wire.engine !== engine
      || wire.schemaVersion !== snapshotSchemaVersion) {
    snapshotFormatError('SNAPSHOT_VERSION', 'Unsupported portable snapshot format or engine');
  }
  if (wire.nativeIntBits !== vm.heap.methodTables.nativeIntBits) snapshotFormatError('SNAPSHOT_ABI', 'Snapshot native integer width differs');
  if (wire.entryToken !== (vm.entryToken ?? vm.report?.entryPoint ?? null)) snapshotFormatError('SNAPSHOT_CODE', 'Snapshot entry point differs');
  if (!Number.isSafeInteger(wire.hostRevision) || wire.hostRevision < 0) snapshotFormatError('SNAPSHOT_HOST_REVISION', 'Invalid host revision');
  try {
    vm.platform.hostOperations.checkRestore(wire.hostRevision);
  } catch (error) {
    snapshotFormatError('SNAPSHOT_HOST_REVISION', error.message);
  }
  const owner = vm.inspector ?? vm.image;
  if (wire.codeIdentity !== await codeIdentity(vm) || owner !== (vm.inspector ?? vm.image)) {
    snapshotFormatError('SNAPSHOT_CODE', 'Portable snapshot was captured from different code');
  }
  try {
    vm.platform.hostOperations.checkRestore(wire.hostRevision);
  } catch (error) {
    snapshotFormatError('SNAPSHOT_HOST_REVISION', error.message);
  }
  try {
    // Resolve portable method keys in an isolated cache, including on malformed input.
    const decoding = Object.create(vm);
    Object.defineProperty(decoding, 'genericInstantiations', {value: null, writable: true});
    const snapshot = decodeSnapshotGraph(decoding, wire.graph, limits);
    if (snapshot?.schemaVersion !== wire.schemaVersion || snapshot.engine !== engine
        || snapshot.hostRevision !== wire.hostRevision || snapshot.owner !== vm.snapshotOwner
        || snapshot.codeOwner !== owner) snapshotFormatError('SNAPSHOT_HEADER', 'Snapshot graph and header disagree');
    validateSnapshotState(vm, snapshot, engine);
    if (engine === 'cil') validateGenericInstantiations(vm, snapshot.genericCacheKeys);
    return snapshot;
  } catch (error) {
    if (error instanceof SnapshotFormatError) throw error;
    snapshotFormatError('SNAPSHOT_GRAPH', 'Invalid portable snapshot graph: ' + error.message);
  }
}

/** Deserialize first, then use the same atomic preflight as an in-memory restore. */
export async function restoreSerializedSnapshot(vm, payload, options = {}) {
  const snapshot = await deserializeSnapshot(vm, payload, options);
  vm.restore(snapshot);
  return vm;
}

export {SnapshotFormatError};
