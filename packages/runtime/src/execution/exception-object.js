import {
  ManagedFault
} from '../heap.js';
import {
  exceptionTypeName,
  exceptionHResult
} from './exception-types.js';

import {
  exceptionFields,
  exceptionSlots
} from './exception-layout.js';
export {
  exceptionFields,
  exceptionSlots
}
from './exception-layout.js';

function isException(vm, reference) {
  const record = vm.heap.get(reference);
  if (record.kind === 'exception') return record;
  for (let type = record.methodTable; type; type = type.base) {
    if (type.name === 'System.Exception') return record;
  }
  throw new ManagedFault('ArgumentException', 'Managed exception reference required');
}

function defaultMessage(type) {
  return `Exception of type '${exceptionTypeName(type)}' was thrown.`;
}

/** Initialize inherited fields, preserving any additional user-defined field slots. */
export function initializeException(vm, reference, message = null, inner = null) {
  const record = isException(vm, reference);
  if (inner !== null) isException(vm, inner);
  vm.heap.withRoots([reference, message, inner], () => {
    const text = message ?? vm.heap.string(defaultMessage(record.methodTable.name));
    const data = [...record.data];
    while (data.length < exceptionFields.length) data.push(null);
    data[exceptionSlots.Message] = text;
    data[exceptionSlots.InnerException] = inner;
    data[exceptionSlots.HResult] = exceptionHResult(record.methodTable.name);
    data[exceptionSlots.Data] = null;
    data[exceptionSlots._stackTrace] = null;
    vm.heap.replaceData(reference, data);
  });
  return reference;
}

/** Allocate a real exception object without executing guest code. */
export function createException(vm, type, message = null, inner = null) {
  return vm.heap.withRoots([message, inner], () => {
    const table = vm.heap.methodTables.get(exceptionTypeName(type));
    const data = Array(Math.max(exceptionFields.length, table.fields.length)).fill(null);
    const reference = vm.heap.allocate('exception', table, data);
    return initializeException(vm, reference, message, inner);
  });
}

function recordFor(vm, reference) {
  const record = isException(vm, reference);
  // Existing platform faults may still provide message/inner slots only.
  if (record.data.length < exceptionFields.length) {
    initializeException(vm, reference, record.data[0] ?? null, record.data[1] ?? null);
  }
  return vm.heap.get(reference);
}

/** Return managed fields; Data is allocated lazily and identity-stable. */
export function exceptionField(vm, reference, name) {
  const record = recordFor(vm, reference);
  const slot = exceptionSlots[name];
  if (slot === undefined) throw new TypeError('Unknown exception field: ' + name);
  if (name !== 'Data' || record.data[slot] !== null) return record.data[slot];
  return vm.heap.withRoots([reference], () => {
    const data = vm.heap.allocate('exception-data', 'System.Collections.Hashtable', []);
    writeExceptionSlot(vm, reference, slot, data);
    return data;
  });
}

export function setExceptionHResult(vm, reference, value) {
  recordFor(vm, reference);
  writeExceptionSlot(vm, reference, exceptionSlots.HResult, Number(value) | 0);
}

/** Plain owned records only: no frame objects, methods, closures or native stacks. */
export function managedStackTrace(vm) {
  return [...vm.frames].reverse().filter(frame => !frame.filterSearch).map(frame => {
    if (frame.method) return {
      method: frame.method.owner + '::' + frame.method.name,
      methodToken: frame.method.token,
      ilOffset: frame.lastOffset
    };
    return {
      method: vm.image.methods[frame.methodId].qualifiedName,
      methodId: frame.methodId,
      instruction: frame.pc - 1,
      point: frame.point ? {
        ...frame.point
      } : null
    };
  });
}

export function exceptionStackTrace(vm, reference) {
  const frames = exceptionField(vm, reference, '_stackTrace');
  if (frames === null) return null;
  return frames.map(frame => frame.previousThrow ? '--- End of stack trace from previous location ---' :
    '   at ' + frame.method.replace('::', '.') + '()').join('\n');
}

/** Materialize a runtime fault and record this throw unless it is a rethrow/EDI continuation. */
export function prepareException(vm, fault) {
  if (!fault.reference) {
    const inner = fault.innerException?.reference ?? null;
    try {
      fault.reference = vm.heap.withRoots([inner], () => createException(vm, fault.name, vm.heap.string(fault.message), inner));
    } catch (failure) {
      if (exceptionTypeName(fault.name) !== 'System.OutOfMemoryException') throw failure;
      // Materializing an allocation failure must not replace its identity with a secondary allocator failure.
      fault.frames ??= managedStackTrace(vm);
      fault.fatal = true;
      throw fault;
    }
  }
  recordFor(vm, fault.reference);
  if (!fault.preserveExceptionTrace || exceptionField(vm, fault.reference, '_stackTrace') === null) {
    const frames = fault.dispatchTrace ? [...fault.dispatchTrace, {
      previousThrow: true
    }, ...managedStackTrace(vm)] : managedStackTrace(vm);
    fault.frames = frames;
    writeExceptionSlot(vm, fault.reference, exceptionSlots._stackTrace, frames);
  } else {
    fault.frames = exceptionField(vm, fault.reference, '_stackTrace');
  }
  fault.preserveExceptionTrace = true;
  return fault;
}

/** `throw ex` creates a fresh dispatch and resets the object's saved trace on raise. */
export function faultFromException(vm, reference) {
  if (reference === null) return new ManagedFault('NullReferenceException', 'A null exception was thrown');
  const record = recordFor(vm, reference);
  return new ManagedFault(record.methodTable.name, vm.value(record.data[exceptionSlots.Message]), reference);
}

/** Follow the managed inner chain without recursion; corrupted cycles fail deterministically. */
export function baseException(vm, reference) {
  const seen = new Set();
  let current = reference;
  while (current !== null) {
    if (seen.has(current.h)) throw new ManagedFault('InvalidProgramException', 'Cyclic InnerException chain');
    seen.add(current.h);
    const inner = exceptionField(vm, current, 'InnerException');
    if (inner === null) return current;
    current = inner;
  }
  return null;
}

export function exceptionText(vm, reference) {
  const record = recordFor(vm, reference);
  const message = vm.value(record.data[exceptionSlots.Message]);
  const trace = exceptionStackTrace(vm, reference);
  return record.methodTable.name + (message ? ': ' + message : '') + (trace === null ? '' : '\n' + trace);
}

/** Change one managed field through the heap mutation and allocation barrier. */
export function writeExceptionSlot(vm, reference, slot, value) {
  const data = [...vm.heap.get(reference).data];
  data[slot] = value;
  vm.heap.replaceData(reference, data);
}
