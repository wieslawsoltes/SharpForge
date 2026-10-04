import {
  ManagedFault
} from '../heap.js';
import {
  createException,
  initializeException,
  exceptionField
} from './exception-object.js';

const innerListSlot = 5;
const collectionType = 'System.Collections.ObjectModel.ReadOnlyCollection`1<System.Exception>';

function inputItems(vm, reference) {
  if (reference === null) throw new ManagedFault('ArgumentNullException', 'innerExceptions');
  const record = vm.heap.get(reference);
  if (record.kind !== 'array' && record.kind !== 'exception-list') {
    throw new ManagedFault('NotSupportedException', 'AggregateException requires a managed exception array or read-only list');
  }
  for (const item of record.data) {
    if (item === null) throw new ManagedFault('ArgumentException', 'An inner exception cannot be null');
    exceptionField(vm, item, 'InnerException');
  }
  return record.data;
}

export function initializeAggregate(vm, reference, parameters, signature) {
  const hasMessage = signature.parameters[0] === 'string';
  const message = hasMessage ? parameters[0] : null;
  const values = parameters.slice(hasMessage ? 1 : 0);
  const listParameter = signature.parameters.at(-1);
  const single = values.length && !listParameter.endsWith('[]') && !listParameter.includes('IEnumerable');
  const items = values.length ? single ? [values[0]].filter(value => value !== null) : [...inputItems(vm, values[0])] : [];
  return vm.heap.withRoots([reference, message, ...items], () => {
    const text = message ?? vm.heap.string('One or more errors occurred.');
    initializeException(vm, reference, text, items[0] ?? null);
    const list = vm.heap.allocate('exception-list', collectionType, items);
    const data = [...vm.heap.get(reference).data];
    data[innerListSlot] = list;
    vm.heap.replaceData(reference, data);
    return reference;
  });
}

export function aggregateInnerList(vm, reference) {
  const record = vm.heap.get(reference);
  if (record.methodTable.name !== 'System.AggregateException') {
    throw new ManagedFault('ArgumentException', 'AggregateException receiver required');
  }
  return record.data[innerListSlot];
}

/** Breadth-first flattening matches nested AggregateException ordering without host recursion. */
export function flattenAggregate(vm, reference) {
  const pending = [reference];
  const result = [];
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    // A repeated shared aggregate is legal; only an ancestor cycle is malformed.
    const path = current.path ?? new Set();
    const item = current.reference ?? current;
    if (path.has(item.h)) throw new ManagedFault('InvalidProgramException', 'Cyclic AggregateException graph');
    const nextPath = new Set(path).add(item.h);
    for (const inner of inputItems(vm, aggregateInnerList(vm, item))) {
      if (vm.heap.get(inner).methodTable.name === 'System.AggregateException') pending.push({
        reference: inner,
        path: nextPath
      });
      else result.push(inner);
    }
    if (pending.length > (vm.options.maxAggregateExceptions ?? 100000)) {
      throw new ManagedFault('ExecutionLimitException', 'AggregateException flattening limit exceeded');
    }
  }
  return vm.heap.withRoots([reference, ...result], () => {
    const message = exceptionField(vm, reference, 'Message');
    const array = vm.heap.allocate('array', 'System.Exception[]', result);
    vm.heap.pins.push(array);
    const flattened = createException(vm, 'System.AggregateException', message);
    return initializeAggregate(vm, flattened, [message, array], {
      parameters: ['string', 'System.Exception[]']
    });
  });
}

export function exceptionListCall(vm, reference, name, args) {
  const data = inputItems(vm, reference);
  if (name === 'get_Count') return data.length;
  const index = args[0];
  if (!Number.isInteger(index) || index < 0 || index >= data.length) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'index');
  }
  return data[index];
}
