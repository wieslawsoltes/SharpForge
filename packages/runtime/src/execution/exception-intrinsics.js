import {
  ManagedFault
} from '../heap.js';
import {
  initializeException,
  exceptionField,
  setExceptionHResult,
  exceptionStackTrace,
  baseException,
  exceptionText
} from './exception-object.js';
import {
  captureExceptionDispatch,
  dispatchSource,
  throwExceptionDispatch
} from './exception-dispatch.js';
import {
  initializeAggregate,
  aggregateInnerList,
  flattenAggregate,
  exceptionListCall
} from './aggregate-exception.js';
import {
  exceptionDataCall
} from './exception-data.js';

export function exceptionConstructor(vm, descriptor, self, parameters) {
  if (descriptor.owner === 'System.AggregateException') initializeAggregate(vm, self, parameters, descriptor.signature);
  else initializeException(vm, self, parameters[0] ?? null, parameters[1] ?? null);
  return null;
}

/** All signatures are admitted by the paired finite exception profile. */
export function exceptionIntrinsic(vm, descriptor, self, parameters) {
  const name = descriptor.name;
  if (descriptor.owner === 'System.Runtime.ExceptionServices.ExceptionDispatchInfo') {
    if (name === 'Capture') return captureExceptionDispatch(vm, parameters[0]);
    if (name === 'get_SourceException') return dispatchSource(vm, self);
    if (descriptor.signature.isStatic) {
      const captured = captureExceptionDispatch(vm, parameters[0]);
      return throwExceptionDispatch(vm, captured);
    }
    return throwExceptionDispatch(vm, self);
  }
  if (descriptor.owner.startsWith('System.Collections.ObjectModel.ReadOnlyCollection`1') ||
    descriptor.owner.startsWith('System.Collections.Generic.IReadOnlyList`1')) {
    return exceptionListCall(vm, self, name, parameters);
  }
  if (['System.Collections.IDictionary', 'System.Collections.Hashtable'].includes(descriptor.owner)) {
    return exceptionDataCall(vm, self, name, parameters);
  }
  if (name === 'get_InnerExceptions') return aggregateInnerList(vm, self);
  if (name === 'Flatten') return flattenAggregate(vm, self);
  if (name === 'get_StackTrace') {
    const trace = exceptionStackTrace(vm, self);
    return trace === null ? null : vm.heap.string(trace);
  }
  if (name === 'set_HResult') {
    setExceptionHResult(vm, self, parameters[0]);
    return null;
  }
  if (name === 'GetBaseException') return baseException(vm, self);
  if (name === 'ToString') return vm.heap.string(exceptionText(vm, self));
  if (name.startsWith('get_')) return exceptionField(vm, self, name.slice(4));
  throw new ManagedFault('MissingMethodException', descriptor.owner + '::' + name);
}
