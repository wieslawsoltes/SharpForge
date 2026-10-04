/** Mutable locations used by bounded debugger expression evaluation. Writes use VM heap barriers. */
export function evaluationLocal(context, name) {
  const frame = context.frame;
  if (!frame) return null;
  if (context.source) {
    const method = context.vm.image.methods[frame.methodId];
    const position = frame.point?.start ?? Infinity;
    const local = method.locals.filter(candidate => candidate.name === name &&
      (candidate.declaredAt ?? 0) <= position && (candidate.scopeEnd ?? Infinity) >= position).at(-1);
    if (!local) return null;
    return {
      type: local.type,
      get: () => frame.locals[local.slot],
      readonly: local.isConst,
      set: value => {
        context.vm.heap.writeRoot(frame.locals, local.slot, value);
        context.vm.notifyWrite({kind: 'local', frameId: frame.id, index: local.slot, value});
      }
    };
  }
  const local = context.session.slots(frame).find(candidate => candidate.name === name || candidate.aliases.includes(name));
  if (!local) return null;
  return {
    type: local.type,
    get: () => local.kind === 'arg' ? frame.args[local.index] : local.kind === 'constant' ? local.raw : frame.locals[local.index],
    readonly: local.readOnly,
    set: value => {
      context.vm.heap.writeRoot(local.kind === 'arg' ? frame.args : frame.locals,
        local.index, context.vm.storage(value, local.type));
      context.vm.writeRevision++;
    }
  };
}

export function evaluationProperty(context, owner, name) {
  if (context.source) return context.vm.image.types.find(type => type.name === owner)?.properties?.find(property => property.name === name);
  const type = context.vm.inspector.types.find(candidate => candidate.name === owner);
  const property = type?.properties.find(candidate => candidate.name === name);
  if (!property) return null;
  const semantics = (context.vm.inspector.metadata.rows[24] ?? [])
    .filter(row => (row[2] >>> 1) === (property.token & 0xffffff) && (row[2] & 1) === 1);
  const get = semantics.find(row => row[0] & 2);
  const set = semantics.find(row => row[0] & 1);
  const signature = context.vm.inspector.signature(property.token);
  return {
    name, type: signature.returnType, isStatic: signature.isStatic,
    get: get ? 0x06000000 | get[1] : null,
    set: set ? 0x06000000 | set[1] : null
  };
}

function sourceField(context, owner, name, receiver) {
  const type = context.vm.image.types.find(candidate => candidate.name === owner);
  if (receiver) {
    const field = type?.fields.find(candidate => candidate.name === name);
    if (!field) return null;
    return {
      type: field.type,
      get: () => context.vm.heap.get(receiver).data[field.index],
      set: value => {
        const record = context.vm.heap.get(receiver);
        const oldValue = record.data[field.index];
        context.vm.heap.writeField(receiver, field.index, value);
        context.vm.notifyWrite({kind: 'field', handle: receiver.h, generation: receiver.g, index: field.index, value, oldValue});
      }
    };
  }
  const index = context.vm.image.statics.findIndex(field => field.name === owner + '.' + name);
  if (index < 0) return null;
  return {
    type: context.vm.image.statics[index].type,
    get: () => context.vm.statics[index],
    set: value => {
      const oldValue = context.vm.statics[index];
      context.vm.heap.writeStatic(context.vm.statics, index, value);
      context.vm.notifyWrite({kind: 'static', index, value, oldValue});
    }
  };
}

function cilField(context, owner, name, receiver) {
  const field = [...context.vm.inspector.fields.values()]
    .find(candidate => candidate.owner === owner && candidate.name === name && candidate.isStatic === !receiver);
  if (!field) return null;
  const type = context.vm.inspector.signature(field.token).type;
  if (receiver) {
    return {
      type,
      get: () => {
        const location = context.vm.field(field.token, receiver);
        return location.record.data[location.index];
      },
      set: value => {
        const location = context.vm.field(field.token, receiver);
        context.vm.dereference(context.vm.address('field', location.index, receiver), true, context.vm.storage(value, type));
      }
    };
  }
  return {
    type,
    get: () => context.vm.statics.get(field.token),
    set: value => {
      context.vm.heap.writeStatic(context.vm.statics, field.token, context.vm.storage(value, type));
      context.vm.writeRevision++;
    }
  };
}

export function evaluationField(context, owner, name, receiver) {
  return context.source ? sourceField(context, owner, name, receiver) : cilField(context, owner, name, receiver);
}

export function evaluationArray(context, reference, index) {
  const record = context.vm.indexed(reference, index);
  const type = record.type.slice(0, -2);
  return {
    type,
    get: () => record.data[index],
    set: value => {
      const oldValue = record.data[index];
      context.vm.heap.writeElement(reference, index, value);
      if (context.source) {
        context.vm.notifyWrite({kind: 'array', handle: reference.h, generation: reference.g, index, value, oldValue});
      } else {
        context.vm.writeRevision++;
      }
    }
  };
}
