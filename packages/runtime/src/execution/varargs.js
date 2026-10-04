import {
  ManagedFault
} from '../heap.js';
import {
  frameById
} from './frame-lifetimes.js';
import {
  address,
  validatePointer,
  pointerType
} from './control-pointers.js';
import {
  runtimeTypeObject
} from './tokens.js';
import {
  boxValue
} from './boxing.js';

function invalid(message) {
  throw new ManagedFault('InvalidProgramException', message);
}

function liveArguments(vm, frameId) {
  const frame = frameById(vm, frameId);
  const convention = !frame ? null : vm.inspector ? frame.method?.signature.callingConvention : vm.image.methods[frame.methodId]?.callingConvention;
  if (convention !== 5 || !Array.isArray(frame.varargs)) {
    invalid('Runtime argument handle outlived its vararg frame');
  }
  return frame;
}

const typeTable = (vm, type) => vm.inspector ? vm.typeSystem.table(type) : vm.heap.methodTables.get(type);

/** Split call-site optional arguments without changing the MethodDef's fixed signature. */
export function splitVarargs(vm, descriptor, args) {
  if (descriptor.signature.callingConvention !== 5) return {
    args,
    extra: {}
  };
  const declaration = vm.inspector.signature(descriptor.resolvedToken ?? descriptor.token);
  const fixed = declaration.parameters.length;
  const sentinel = descriptor.signature.sentinel ?? descriptor.signature.parameters.length;
  if (declaration.callingConvention !== 5 || sentinel !== fixed) invalid('Vararg call-site fixed signature mismatch');
  const first = fixed + (declaration.isStatic ? 0 : 1);
  const optional = descriptor.signature.parameters.slice(fixed).map((type, index) => ({
    type: vm.typeSystem.table(type),
    value: vm.storage(args[first + index], type)
  }));
  return {
    args: args.slice(0, first),
    extra: {
      optionalArguments: optional
    }
  };
}

/** Attach optional values to addressable argument slots after normal fixed binding. */
export function attachVarargs(method, args, optional = []) {
  if (method.signature.callingConvention !== 5) {
    if (optional.length) invalid('Optional varargs supplied to a non-vararg method');
    return null;
  }
  return optional.map(({
    type,
    value
  }) => {
    const index = args.length;
    args.push(value);
    return {
      type,
      index
    };
  });
}

export function argumentHandle(vm, frame = vm.top) {
  liveArguments(vm, frame.id);
  return Object.freeze({
    runtimeArgumentHandle: true,
    vmOwner: vm.snapshotOwner,
    frameId: frame.id
  });
}

export function typedReference(vm, pointer, type) {
  validatePointer(vm, pointer);
  const table = typeTable(vm, type);
  if (pointerType(vm, pointer) !== table) throw new ManagedFault('InvalidCastException', 'Typed reference type mismatch');
  return Object.freeze({
    typedReference: true,
    vmOwner: vm.snapshotOwner,
    pointer,
    type: table
  });
}

function validateTypedReference(vm, reference) {
  if (!reference?.typedReference || !Object.isFrozen(reference) || reference.vmOwner !== vm.snapshotOwner ||
    reference.type?.registry !== vm.heap.methodTables) invalid('Typed reference is malformed or belongs to another VM');
  validatePointer(vm, reference.pointer);
  if (pointerType(vm, reference.pointer) !== reference.type) invalid('Typed reference location type changed');
  return reference;
}

export function typedReferenceValue(vm, reference, type) {
  validateTypedReference(vm, reference);
  if (reference.type !== typeTable(vm, type)) throw new ManagedFault('InvalidCastException', 'Typed reference type mismatch');
  return reference.pointer;
}

export function typedReferenceType(vm, reference) {
  validateTypedReference(vm, reference);
  return Object.freeze({
    runtimeHandle: 'type',
    owner: vm.snapshotOwner,
    table: reference.type,
    token: reference.type.token
  });
}

function iteratorValue(vm, value) {
  const iterator = value?.byref ? vm.dereference(value) : value;
  if (!iterator?.argIterator || iterator.vmOwner !== vm.snapshotOwner || !Object.isFrozen(iterator)) {
    invalid('ArgIterator is uninitialized or belongs to another VM');
  }
  const frame = liveArguments(vm, iterator.frameId);
  if (iterator.ended) throw new ManagedFault('InvalidOperationException', 'ArgIterator has ended');
  return {
    iterator,
    frame
  };
}

function iteratorStep(vm, self, name, args) {
  const {
    iterator,
    frame
  } = iteratorValue(vm, self);
  if (name === 'GetRemainingCount') return frame.varargs.length - iterator.index;
  if (name === 'End') {
    vm.dereference(self, true, Object.freeze({
      ...iterator,
      ended: true
    }));
    return null;
  }
  const item = frame.varargs[iterator.index];
  if (!item) throw new ManagedFault('InvalidOperationException', 'There are no remaining arguments');
  const slot = address(vm, vm.inspector ? 'arg' : 'local', item.index, null, {
    frameId: frame.id,
    type: item.type
  });
  const pointer = item.type.flags.byRef ? vm.dereference(slot) : slot;
  const type = item.type.flags.byRef ? pointerType(vm, pointer) : item.type;
  const reference = typedReference(vm, pointer, type);
  if (name === 'GetNextArgType') return typedReferenceType(vm, reference);
  if (args.length && (args[0]?.runtimeHandle !== 'type' || args[0].owner !== vm.snapshotOwner || args[0].table !== type)) {
    throw new ManagedFault('InvalidCastException', 'ArgIterator requested type does not match the next argument');
  }
  vm.dereference(self, true, Object.freeze({
    ...iterator,
    index: iterator.index + 1
  }));
  return reference;
}

/** Runtime-provided ArgIterator and TypedReference operations do not expose raw addresses. */
export function varargsCall(vm, descriptor, args, opcode = 'call') {
  const owner = descriptor.owner;
  if (owner !== 'System.ArgIterator' && owner !== 'System.TypedReference') return {
    handled: false
  };
  const parameters = descriptor.signature.isStatic || opcode === 'newobj' ? args : args.slice(1);
  let value;
  if (owner === 'System.TypedReference') {
    const reference = validateTypedReference(vm, parameters[0]);
    if (descriptor.name === 'ToObject') {
      const current = vm.dereference(reference.pointer);
      value = reference.type.flags.valueType ? boxValue(vm, current, reference.type) : current;
    } else if (descriptor.name === 'GetTargetType') value = runtimeTypeObject(vm, reference.type);
    else value = typedReferenceType(vm, reference);
  } else if (descriptor.name === '.ctor') {
    const handle = parameters[0];
    if (!handle?.runtimeArgumentHandle || !Object.isFrozen(handle) || handle.vmOwner !== vm.snapshotOwner) {
      invalid('Invalid RuntimeArgumentHandle');
    }
    liveArguments(vm, handle.frameId);
    value = Object.freeze({
      argIterator: true,
      vmOwner: vm.snapshotOwner,
      frameId: handle.frameId,
      index: 0,
      ended: false
    });
    if (opcode !== 'newobj') vm.dereference(args[0], true, value);
  } else value = iteratorStep(vm, args[0], descriptor.name, parameters);
  return {
    handled: true,
    returns: opcode === 'newobj' || descriptor.signature.returnType !== 'void',
    value
  };
}
