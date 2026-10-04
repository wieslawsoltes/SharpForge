import {runtimeTypeText} from './tokens.js';
import {enumToString} from './enums.js';
import {ManagedFault, isReference} from '../heap.js';

/** Boxed UI values format through their contained scalar without changing reference equality semantics. */
export function formatSourceValue(vm, value) {
  let depth = 0;
  while (isReference(value) && vm.heap.get(value).kind === 'box') {
    if (++depth > 128) throw new ManagedFault('ExecutionLimitException', 'Boxed value formatting limit');
    value = vm.heap.get(value).data[0];
  }
  const name = runtimeTypeText(vm, value) ?? enumToString(vm, value);
  if (name !== null) return name;
  if (value === null) return '';
  if (value === undefined) return '<unassigned>';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (isReference(value)) {
    const record = vm.heap.get(value);
    if (record.kind === 'string') return record.data;
    if (record.kind === 'exception') return record.type + ': ' + vm.format(record.data[0]);
    return record.type;
  }
  return String(value);
}
