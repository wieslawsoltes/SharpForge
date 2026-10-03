const fail = message => { throw new TypeError('Invalid memory snapshot: ' + message); };
const sameReference = (left, right) => left?.h === right?.h && left?.g === right?.g;

/** Validate captured regions and leases against captured heap records, never live data. */
export function validateMemorySnapshot(vm, snapshot) {
  const frames = new Map();
  const contexts = snapshot.scheduler?.contexts ?? [];
  for (const frame of snapshot.frames) frames.set(frame.id, frame);
  for (const [, context] of contexts) {
    if (['completed', 'faulted', 'canceled'].includes(context.status)) continue;
    for (const frame of context.frames) {
      if (frames.has(frame.id) && frames.get(frame.id) !== frame) fail('duplicate frame');
      frames.set(frame.id, frame);
    }
  }
  const sequence = snapshot.memorySequence ?? 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0) fail('allocation identity');
  const handles = new Map(snapshot.heap.handles ?? []);
  const regions = new Set();
  let bytes = 0;
  const recordFor = reference => {
    const record = snapshot.heap.records[reference?.h];
    if (!record || snapshot.heap.generations[reference.h] !== reference.g) fail('stale pin owner');
    return record;
  };
  for (const frame of frames.values()) {
    if (frame.stackRegions !== undefined && !(frame.stackRegions instanceof Map)) fail('stack region map');
    for (const [id, region] of frame.stackRegions ?? []) {
      if (!Number.isSafeInteger(id) || id < 1 || id > sequence || regions.has(id)) fail('stack region identity');
      if (!(region.bytes instanceof Uint8Array)) fail('stack bytes');
      regions.add(id);
      bytes += region.bytes.byteLength;
    }
    if (frame.pinLeases !== undefined && !(frame.pinLeases instanceof Map)) fail('pin lease map');
    for (const [index, lease] of frame.pinLeases ?? []) {
      if (!Number.isInteger(index) || index < 0 || index >= frame.locals.length || !lease.active ||
          !Number.isSafeInteger(lease.id) || lease.id < 1 || lease.id > sequence || regions.has(lease.id)) fail('pin identity');
      regions.add(lease.id);
      const handle = handles.get(lease.handle?.id);
      if (lease.handle?.owner !== vm.heap.handleOwner || !handle || handle.weak || !sameReference(handle.value, lease.owner)) {
        fail('pin handle ownership');
      }
      if (recordFor(lease.owner).kind !== 'array') fail('pin requires an array');
    }
  }
  if (bytes > (vm.options?.maxStackMemoryBytes ?? 1024 * 1024)) fail('stack memory budget');
  const pending = [snapshot.frames, contexts, snapshot.statics, snapshot.returnValue];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value.memoryPointer) validatePointer(value, vm, frames, recordFor);
    if (value.span && (!Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner ||
        !Number.isSafeInteger(value.length) || value.length < 0 || value.length > 0 && !value.pointer)) fail('Span state');
    if (value.registry && value.flags || value === vm.snapshotOwner || value === vm.heap.handleOwner || ArrayBuffer.isView(value)) continue;
    if (value instanceof Map) {
      for (const [key, item] of value) pending.push(key, item);
    } else if (value instanceof Set) pending.push(...value);
    else for (const [key, item] of Object.entries(value)) {
      if (!['method', 'offsets', 'vmOwner', 'owner', 'baseType', 'elementType', 'valueType', 'nullableType'].includes(key)) pending.push(item);
    }
  }
}

function validatePointer(pointer, vm, frames, recordFor) {
  if (!Object.isFrozen(pointer) || pointer.vmOwner !== vm.snapshotOwner || pointer.baseType?.registry !== vm.heap.methodTables ||
      !Number.isSafeInteger(pointer.index) || pointer.index < 0) fail('pointer ownership or offset');
  if (pointer.kind === 'reinterpret') {
    if (!pointer.source?.byref || pointer.sourceType?.registry !== vm.heap.methodTables) fail('reinterpretation source');
    return;
  }
  const frame = frames.get(pointer.frameId);
  if (!frame) fail('expired frame');
  if (pointer.kind === 'stack') {
    const region = frame.stackRegions?.get(pointer.regionId);
    if (!region || pointer.index > region.bytes.byteLength) fail('expired stack region or offset');
  } else if (pointer.kind === 'pinned') {
    const lease = frame.pinLeases?.get(pointer.localIndex);
    if (!lease?.active || lease.id !== pointer.leaseId || !sameReference(lease.owner, pointer.owner)) fail('expired pin');
    const data = recordFor(pointer.owner).data;
    if (typeof data.byteLength !== 'number' || pointer.index > data.byteLength) fail('pin bounds');
  } else fail('pointer kind');
}
