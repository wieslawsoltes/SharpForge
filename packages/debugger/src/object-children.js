import {isReference} from '@sharpforge/runtime';

// TypedArray.map coerces descriptors back to the numeric element type. Build a
// bounded ordinary array so debugger records preserve their fields and handles.
function childPage(record, start, count, project) {
  const result = [];
  const end = Math.min(record.data.length, start + count);
  for (let index = start; index < end; index++) {
    result.push(project(record.data[index], index));
  }
  return result;
}

export function sourceObjectChildren(session, reference, start, count) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 || count > 10000) {
    throw new RangeError('Invalid variable page');
  }
  const record = session.vm.heap.get(reference);
  if (record.kind === 'string') {
    return [{name: 'Length', type: 'int', value: String(record.data.length), raw: record.data.length}];
  }
  const fields = session.vm.image.types.find(type => type.name === record.type)?.fields;
  return childPage(record, start, count, (value, index) => ({
    name: record.kind === 'array' ? `[${index}]` : fields?.[index]?.name ?? (record.kind === 'exception' ? 'Message' : String(index)),
    type: fields?.[index]?.type ?? (record.kind === 'array' ? record.type.slice(0, -2) : 'string'),
    value: session.vm.display(value),
    raw: value,
    reference: isReference(value) ? value : null
  }));
}

export function cilObjectChildren(session, reference, start, count) {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count < 1 || count > 1000) {
    throw new RangeError('Invalid object inspection page');
  }
  const record = session.vm.heap.get(reference);
  if (record.kind === 'string') return [session.variable('Length', 'int', record.data.length)];
  const definition = session.vm.inspector.types.find(type => type.name === record.type);
  const fields = definition ? session.vm.layout(definition.token).fields : [];
  return childPage(record, start, count, (value, index) => session.variable(
    record.kind === 'array' ? `[${index}]` : fields[index]?.name ?? (record.kind === 'exception' ? 'Message' : `Field ${index}`),
    fields[index]?.type ?? (record.kind === 'array' ? record.type.slice(0, -2) : 'object'),
    value
  ));
}
