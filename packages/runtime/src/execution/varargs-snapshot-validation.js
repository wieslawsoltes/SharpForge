function reject(message) {
  throw new TypeError('Invalid varargs snapshot: ' + message);
}

/** Pure validation against saved frames; live pointer/frame indexes are never consulted. */
export function validateVarargsSnapshot(vm, snapshot) {
  const frames = new Map(snapshot.frames.map(frame => [frame.id, frame]));
  for (const [, context] of snapshot.scheduler?.contexts ?? []) {
    for (const frame of context.frames) frames.set(frame.id, frame);
  }
  for (const frame of frames.values()) {
    const method = vm.inspector ? frame.method : vm.image.methods[frame.methodId];
    const signature = vm.inspector ? method?.signature : method;
    if (signature?.callingConvention !== 5) {
      if (frame.varargs !== undefined) reject('packet on a non-vararg method');
      continue;
    }
    if (!Array.isArray(frame.varargs)) reject('missing argument packet');
    const fixed = vm.inspector ? signature.parameters.length + (signature.isStatic ? 0 : 1) : method.locals.length;
    const slots = vm.inspector ? frame.args : frame.locals;
    if (!Array.isArray(slots) || slots.length !== fixed + frame.varargs.length) reject('packet and argument count disagree');
    for (const [index, item] of frame.varargs.entries()) {
      if (item.index !== fixed + index || item.type?.registry !== vm.heap.methodTables ||
        item.type.containsGenericParameters || item.type.name === 'System.Void') reject('malformed argument slot');
    }
  }
  const pending = [...frames.values()];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value.runtimeArgumentHandle || value.argIterator) {
      const frame = frames.get(value.frameId);
      if (!Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner || !frame?.varargs) reject('foreign or expired handle');
      if (value.argIterator && (!Number.isInteger(value.index) || value.index < 0 || value.index > frame.varargs.length ||
          typeof value.ended !== 'boolean')) reject('malformed iterator position');
      continue;
    }
    if (value.typedReference) {
      if (!Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner ||
        value.type?.registry !== vm.heap.methodTables || !value.pointer?.byref) reject('malformed typed reference');
      pending.push(value.pointer);
      continue;
    }
    if (value.registry || value.methodPointer || value.runtimeHandle || Number.isInteger(value.h)) continue;
    if (value instanceof Map) {
      for (const item of value.values()) pending.push(item);
    } else if (Array.isArray(value)) pending.push(...value);
    else
      for (const [key, item] of Object.entries(value)) {
        if (key !== 'method' && key !== 'offsets' && key !== 'vmOwner') pending.push(item);
      }
  }
}
