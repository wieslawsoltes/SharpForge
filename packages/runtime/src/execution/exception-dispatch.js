import {
  ManagedFault
} from '../heap.js';
import {
  exceptionField,
  faultFromException
} from './exception-object.js';

/** EDI stores an immutable logical trace and roots the captured exception through its heap slots. */
export function captureExceptionDispatch(vm, reference) {
  if (reference === null) throw new ManagedFault('ArgumentNullException', 'source');
  const frames = exceptionField(vm, reference, '_stackTrace');
  const copy = frames === null ? null : frames.map(frame => ({
    ...frame
  }));
  return vm.heap.allocate('exception-dispatch', 'System.Runtime.ExceptionServices.ExceptionDispatchInfo', [reference, copy]);
}

export function dispatchSource(vm, reference) {
  const record = vm.heap.get(reference);
  if (record.kind !== 'exception-dispatch') throw new ManagedFault('ArgumentException', 'ExceptionDispatchInfo required');
  return record.data[0];
}

/** Throw resumes the captured trace even if the same exception was thrown again meanwhile. */
export function throwExceptionDispatch(vm, reference) {
  const source = dispatchSource(vm, reference);
  const fault = faultFromException(vm, source);
  fault.dispatchTrace = vm.heap.get(reference).data[1];
  throw fault;
}
