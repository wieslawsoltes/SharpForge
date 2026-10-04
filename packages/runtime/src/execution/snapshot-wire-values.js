import {ManagedFault, isReference} from './managed-fault.js';
import {ReadonlySnapshotArray} from './snapshot-buffers.js';
import {instantiatedMethod} from './generics.js';
import {createHeapReference, ownsHeapReference} from './heap-reference.js';
import {createMethodPointer, isMethodPointer} from './method-pointers.js';

const views = new Map([
  ['Int8Array', Int8Array], ['Uint8Array', Uint8Array], ['Uint8ClampedArray', Uint8ClampedArray],
  ['Int16Array', Int16Array], ['Uint16Array', Uint16Array], ['Int32Array', Int32Array],
  ['Uint32Array', Uint32Array], ['Float32Array', Float32Array], ['Float64Array', Float64Array],
  ['BigInt64Array', BigInt64Array], ['BigUint64Array', BigUint64Array], ['DataView', DataView]
]);

/** Wire failures carry stable codes and never run managed or host operations. */
export class SnapshotFormatError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'SnapshotFormatError';
    this.code = code;
  }
}

export function snapshotFormatError(code, message) {
  throw new SnapshotFormatError(code, message);
}

export function snapshotLimits(options = {}) {
  const limits = {maxNodes: 1000000, maxBytes: 64 * 1024 * 1024, maxItems: 8000000, ...options};
  for (const name of ['maxNodes', 'maxBytes', 'maxItems']) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1) throw new RangeError('Invalid snapshot ' + name);
  }
  return limits;
}

export function encodeBytes(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(text);
}

export function decodeBytes(text, limit) {
  if (typeof text !== 'string' || text.length > Math.ceil(limit / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    snapshotFormatError('SNAPSHOT_BYTES', 'Invalid encoded snapshot bytes');
  }
  const raw = atob(text);
  if (raw.length > limit) snapshotFormatError('SNAPSHOT_LIMIT', 'Snapshot byte limit exceeded');
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function wireAtom(value) {
  if (typeof value === 'bigint') return ['integer', value.toString()];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return ['number', 'NaN'];
    if (value === Infinity) return ['number', 'Infinity'];
    if (value === -Infinity) return ['number', '-Infinity'];
    if (Object.is(value, -0)) return ['number', '-0'];
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    snapshotFormatError('SNAPSHOT_HOST_VALUE', 'Snapshots cannot contain functions or symbols');
  }
  return value;
}

export function readWireAtom(atom, nodes) {
  if (!Array.isArray(atom)) {
    if (atom === null || ['string', 'boolean'].includes(typeof atom)
        || typeof atom === 'number' && Number.isFinite(atom)) return atom;
    snapshotFormatError('SNAPSHOT_ATOM', 'Invalid snapshot scalar');
  }
  const [kind, value] = atom;
  if (kind === 'ref' && atom.length === 2 && Number.isInteger(value) && value >= 0 && value < nodes.length) {
    return nodes[value];
  }
  if (kind === 'undefined' && atom.length === 1) return undefined;
  if (kind === 'integer' && atom.length === 2 && typeof value === 'string' && value.length <= 2048 && /^-?(0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  if (kind === 'number' && atom.length === 2) {
    if (value === 'NaN') return NaN;
    if (value === 'Infinity') return Infinity;
    if (value === '-Infinity') return -Infinity;
    if (value === '-0') return -0;
  }
  snapshotFormatError('SNAPSHOT_ATOM', 'Unknown snapshot scalar encoding');
}

/** Encode code/type identities as keys, never runtime registry graphs. */
export function ownedWireValue(vm, value) {
  if (value === vm.snapshotOwner) return {kind: 'owner', owner: 'vm'};
  if (value === vm.heap.handleOwner) return {kind: 'owner', owner: 'heap'};
  if (value === (vm.inspector ?? vm.image)) return {kind: 'owner', owner: 'code'};
  if (value.byref || value.span || value.methodPointer || value.typedReference || value.runtimeArgumentHandle || value.argIterator) {
    if (!Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner) {
      snapshotFormatError('SNAPSHOT_OWNER', 'A memory value belongs to another VM or is mutable');
    }
  }
  if (value.registry && value.flags && value.registry !== vm.heap.methodTables) {
    snapshotFormatError('SNAPSHOT_OWNER', 'A memory value type belongs to another VM');
  }
  if (isReference(value)) {
    if (!ownsHeapReference(vm.heap, value)) {
      snapshotFormatError('SNAPSHOT_OWNER', 'A managed reference belongs to another heap');
    }
    return {kind: 'handle', handle: value.h, generation: value.g};
  }
  if (value.methodPointer) {
    if (!isMethodPointer(vm, value)) snapshotFormatError('SNAPSHOT_OWNER', 'Unissued managed method pointer');
    return {kind: 'methodPointer', token: value.token};
  }
  if (value.registry === vm.heap.methodTables && value.flags && typeof value.name === 'string') {
    return {kind: 'type', name: value.name};
  }
  if (vm.inspector && Number.isInteger(value.token) && Array.isArray(value.instructions)) {
    const original = vm.inspector.getMethod(value.token);
    if (original.instructions === value.instructions) {
      return {kind: 'method', token: value.token, genericIdentity: value.genericIdentity ?? null,
        methodArguments: [...(value.methodArguments ?? [])]};
    }
  }
  return null;
}

export function restoreWireIdentity(vm, node) {
  if (node.kind === 'owner') {
    if (node.owner === 'vm') return vm.snapshotOwner;
    if (node.owner === 'heap') return vm.heap.handleOwner;
    if (node.owner === 'code') return vm.inspector ?? vm.image;
  }
  if (node.kind === 'handle') {
    if (!Number.isSafeInteger(node.handle) || node.handle < 0
        || !Number.isSafeInteger(node.generation) || node.generation < 1) {
      snapshotFormatError('SNAPSHOT_HANDLE', 'Invalid managed snapshot handle');
    }
    return createHeapReference(vm.heap, node.handle, node.generation);
  }
  if (node.kind === 'methodPointer') {
    if (!vm.inspector || !Number.isSafeInteger(node.token) || !vm.report.methods.includes(node.token)) {
      snapshotFormatError('SNAPSHOT_IDENTITY', 'Invalid managed method pointer token');
    }
    return createMethodPointer(vm, node.token);
  }
  if (node.kind === 'type' && typeof node.name === 'string' && node.name.length <= 16384) {
    return vm.heap.methodTables.get(node.name);
  }
  if (node.kind === 'method' && vm.inspector && vm.report.methods.includes(node.token)
      && (node.genericIdentity === null || typeof node.genericIdentity === 'string')
      && Array.isArray(node.methodArguments) && node.methodArguments.length <= 1024
      && node.methodArguments.every(type => typeof type === 'string' && type.length <= 16384)) {
    return instantiatedMethod(vm, node.token, node.genericIdentity, node.methodArguments);
  }
  snapshotFormatError('SNAPSHOT_IDENTITY', 'Invalid snapshot code or runtime identity');
}

export function constructWireView(node, buffer) {
  const constructor = views.get(node.type);
  if (!constructor || !(buffer instanceof ArrayBuffer)
      || !Number.isSafeInteger(node.offset) || node.offset < 0
      || !Number.isSafeInteger(node.length) || node.length < 0
      || typeof node.readonly !== 'boolean' || node.readonly && node.type === 'DataView') {
    snapshotFormatError('SNAPSHOT_VIEW', 'Invalid snapshot typed view');
  }
  try {
    const view = new constructor(buffer, node.offset, node.length);
    return node.readonly ? new ReadonlySnapshotArray(view) : view;
  } catch (error) {
    snapshotFormatError('SNAPSHOT_VIEW', 'Snapshot typed view exceeds its buffer: ' + error.message);
  }
}

export {ManagedFault, ReadonlySnapshotArray};
