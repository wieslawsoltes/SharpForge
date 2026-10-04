import {rootReference} from './reference.js';
import {ManagedFault} from './fault.js';

function shared(values) {
  const view = new Int32Array(new SharedArrayBuffer(values.length * 4));
  view.set(values);
  return view.buffer;
}

function trackedStorage(heap, record) {
  const storage = record.storage;
  if (!storage || !['utf16', 'primitive', 'slots'].includes(storage.format)) return false;
  const binding = heap.spaces?.bindings.get(storage.blockId);
  return binding?.record === record && binding.arena.id === storage.arenaId;
}

/** Capture descriptor-directed handle edges at a safepoint; host payload values never cross the worker boundary. */
export function captureBackgroundGraph(heap, extraRoots = [], options = {}) {
  const maxObjects = options.maxObjects ?? 1_000_000;
  const maxEdges = options.maxEdges ?? 10_000_000;
  const maxRoots = options.maxRoots ?? 1_000_000;
  const maxSlots = options.maxSlots ?? 10_000_000;
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 1_000_000 ||
      !Number.isInteger(maxEdges) || maxEdges < 0 || maxEdges > 10_000_000 ||
      !Number.isInteger(maxRoots) || maxRoots < 1 || maxRoots > 1_000_000 ||
      !Number.isInteger(maxSlots) || maxSlots < 0 || maxSlots > 10_000_000) {
    throw new RangeError('Invalid background graph capture limits');
  }
  const references = [];
  const indices = new Map();
  for (let handle = 0; handle < heap.records.length; handle++) {
    const record = heap.records[handle];
    if (!record || record.space === 'frozen' || !trackedStorage(heap, record)) continue;
    if (references.length >= maxObjects) throw new ManagedFault('ExecutionLimitException', 'Background graph object limit exceeded');
    const reference = heap.referenceAt(handle);
    indices.set(handle, references.length);
    references.push(reference);
  }
  const indexOf = value => {
    value = rootReference(value);
    if (!value) return -1;
    const record = heap.tryGet(value);
    if (!record || record.space === 'frozen') return -1;
    if (!trackedStorage(heap, record)) {
      throw new ManagedFault('NotSupportedException', 'Background marking requires managed arena-backed reachable objects');
    }
    const index = indices.get(value.h);
    if (index === undefined) throw new Error('Background graph invariant: missing arena vertex');
    return index;
  };
  const roots = [];
  let rootSlots = 0;
  heap.visitRoots(value => {
    if (++rootSlots > maxRoots) throw new ManagedFault('ExecutionLimitException', 'Background graph root limit exceeded');
    const index = indexOf(value);
    if (index >= 0) roots.push(index);
  }, extraRoots);
  const offsets = [0];
  const edges = [];
  let scannedSlots = 0;
  const visitEdge = value => {
    if (++scannedSlots > maxSlots) throw new ManagedFault('ExecutionLimitException', 'Background graph slot limit exceeded');
    const index = indexOf(value);
    if (index < 0) return;
    if (edges.length >= maxEdges) throw new ManagedFault('ExecutionLimitException', 'Background graph edge limit exceeded');
    edges.push(index);
  };
  for (const reference of references) {
    heap.visitEdges(heap.get(reference), visitEdge);
    offsets.push(edges.length);
  }
  const count = references.length;
  return {
    references, indices, allocationSerial: heap.generationCounter,
    graph: {
      schemaVersion: 1, vertexCount: count,
      offsets: shared(offsets), edges: shared(edges), roots: shared(roots),
      marks: new SharedArrayBuffer(count * 4), cards: new SharedArrayBuffer(count * 4),
      status: new SharedArrayBuffer(16)
    }
  };
}
