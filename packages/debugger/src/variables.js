import {isReference} from '@sharpforge/runtime';
import {retainDebuggerValue} from './roots.js';

/** Rendered references stay owned by the debugger's existing root scope. */
export function evaluationResult(session, result, booleanText = false) {
  return {
    ...result,
    result: booleanText && result.type === 'bool' ? (result.value ? 'True' : 'False') : session.vm.display(result.value),
    reference: isReference(result.value) ? retainDebuggerValue(session, result.value) : null
  };
}

export function cilVariable(session, name, type, value, extra = {}) {
  retainDebuggerValue(session, value);
  return {
    name, type,
    value: value === undefined ? '<unassigned>' : value?.byref ? `&${value.kind}[${value.index}]` : session.vm.display(value),
    raw: value,
    reference: isReference(value) ? value : null,
    ...extra
  };
}

export function sourceLocals(session, frameId) {
  const frame = session.frame(frameId);
  const method = session.vm.image.methods[frame.methodId];
  const offset = frame.point?.start ?? 0;
  return method.locals.filter(local => (!local.hidden || local.name === 'this') &&
    (local.declaredAt ?? 0) <= offset && (local.scopeEnd ?? Infinity) >= offset)
    .map(local => ({
      name: local.name,
      type: local.type,
      value: session.vm.display(frame.locals[local.slot]),
      raw: frame.locals[local.slot],
      reference: isReference(frame.locals[local.slot]) ? retainDebuggerValue(session, frame.locals[local.slot]) : null,
      slot: local.slot, kind: 'local', index: local.slot
    }));
}

export function sourceStatics(session) {
  return session.vm.image.statics.map((field, index) => ({
    name: field.name,
    type: field.type,
    value: session.vm.display(session.vm.statics[index]),
    raw: session.vm.statics[index],
    reference: isReference(session.vm.statics[index]) ? retainDebuggerValue(session, session.vm.statics[index]) : null,
    index
  }));
}

export function sourceChildren(session, reference, start, count) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 || count > 10000) {
    throw new RangeError('Invalid variable page');
  }
  const record = session.vm.heap.get(reference);
  if (record.kind === 'string') {
    return [{name: 'Length', type: 'int', value: String(record.data.length), raw: record.data.length}];
  }
  const fields = session.vm.image.types.find(type => type.name === record.type)?.fields;
  return record.data.slice(start, start + count).map((value, index) => ({
    name: record.kind === 'array' ? `[${start + index}]` :
      fields?.[start + index]?.name ?? (record.kind === 'exception' ? 'Message' : String(start + index)),
    type: fields?.[start + index]?.type ?? (record.kind === 'array' ? record.type.slice(0, -2) : 'string'),
    value: session.vm.display(value),
    raw: value,
    reference: isReference(value) ? retainDebuggerValue(session, value) : null
  }));
}
