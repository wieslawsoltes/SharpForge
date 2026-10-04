import {validateSnapshotState} from '../snapshot-validation.js';
import {prepareGenericInstantiations, snapshotResolutionContext} from './generic-snapshot.js';
import {validateSnapshotHeader} from '../snapshot.js';
import {encodeSnapshotGraph, decodeSnapshotGraph} from './snapshot-wire-graph.js';
import {SnapshotFormatError, snapshotFormatError, snapshotLimits} from './snapshot-wire-values.js';
import {snapshotSchemaVersion} from './snapshot-version.js';
import {resolveSnapshotTypes} from './snapshot-type-resolution.js';
import {assertSnapshotJSON, assertSnapshotText, snapshotJSONString} from './snapshot-json.js';

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
  const owner = vm.inspector ?? vm.image;
  const source = vm.inspector ? null : imageText(vm.image);
  const currentBytes = vm.inspector?.pe.bytes;
  const bytes = currentBytes ? new Uint8Array(currentBytes).slice() : new TextEncoder().encode(source);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const changed = owner !== (vm.inspector ?? vm.image) || (source !== null ? imageText(vm.image) !== source
    : vm.inspector.pe.bytes.length !== bytes.length || bytes.some((value, index) => value !== vm.inspector.pe.bytes[index]));
  if (changed) snapshotFormatError('SNAPSHOT_CODE', 'Code changed during portable snapshot identity validation');
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Export a JSON/structured-clone safe graph tied to exact code bytes and ABI. */
export async function serializeSnapshot(vm, snapshot = vm.snapshot(), options = {}) {
  const limits = snapshotLimits(options);
  if (snapshot?.owner !== vm.snapshotOwner || snapshot.codeOwner !== (vm.inspector ?? vm.image)) {
    snapshotFormatError('SNAPSHOT_OWNER', 'Snapshot belongs to another VM or code generation');
  }
  validateSnapshotHeader(vm, snapshot, snapshot.engine);
  validateSnapshotState(vm, snapshot, snapshot.engine);
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
  const text = snapshotJSONString(wire, limits);
  return options.json ? text : wire;
}

function readPayload(payload, limits) {
  if (typeof payload !== 'string') {
    return JSON.parse(snapshotJSONString(payload, limits));
  }
  assertSnapshotText(payload, limits);
  try {
    const wire = JSON.parse(payload);
    assertSnapshotJSON(wire, limits);
    return wire;
  } catch (error) {
    if (error instanceof SnapshotFormatError) throw error;
    snapshotFormatError('SNAPSHOT_JSON', 'Invalid portable snapshot JSON: ' + error.message);
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
    return resolveSnapshotTypes(vm, () => {
      const decoding = snapshotResolutionContext(vm);
      const snapshot = decodeSnapshotGraph(decoding, wire.graph, limits);
      if (snapshot?.schemaVersion !== wire.schemaVersion || snapshot.engine !== engine
          || snapshot.hostRevision !== wire.hostRevision || snapshot.owner !== vm.snapshotOwner
          || snapshot.codeOwner !== owner) snapshotFormatError('SNAPSHOT_HEADER', 'Snapshot graph and header disagree');
      validateSnapshotHeader(vm, snapshot, engine);
      validateSnapshotState(vm, snapshot, engine);
      if (engine === 'cil') prepareGenericInstantiations(vm, snapshot.genericCacheKeys);
      return snapshot;
    });
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
