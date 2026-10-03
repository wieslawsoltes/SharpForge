import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {argumentHandle, typedReference, typedReferenceValue, varargsCall} from './varargs.js';
import {runtimeTypeObject} from './tokens.js';
import {sourceStore} from './source-storage.js';

export function executeSourceVarargs(vm, frame, op, a) {
  if (op === Op.ARGLIST) vm.stack.push(argumentHandle(vm, frame));
  else if (op === Op.MKREFANY) vm.stack.push(typedReference(vm, vm.stack.pop(), vm.image.constants[a]));
  else if (op === Op.REFANYVAL) vm.stack.push(typedReferenceValue(vm, vm.stack.pop(), vm.image.constants[a]));
  else if (op === Op.REFANYTYPE) {
    const value = vm.stack.pop();
    typedReferenceValue(vm, value, value?.type);
    vm.stack.push(runtimeTypeObject(vm, value.type));
  } else return false;
  return true;
}

export function sourceVarargsBuiltin(vm, profile, args) {
  const descriptor = {kind: 'method', ...profile, signature: profile};
  return vm.heap.withRoots(args, () => varargsCall(vm, descriptor, args, profile.name === '.ctor' ? 'newobj' : 'call').value);
}

/** Optional arguments use extra local slots so returned typed references retain their declaring frame. */
export function appendSourceVarargs(vm, method, locals, args, types, fixed) {
  if (method.callingConvention !== 5) {
    if (args.length !== fixed) throw new ManagedFault('InvalidProgramException', 'Source method argument count mismatch');
    return null;
  }
  if (args.length < fixed) throw new ManagedFault('InvalidProgramException', 'Missing fixed vararg arguments');
  return args.slice(fixed).map((value, index) => {
    const type = vm.heap.methodTables.get(types[fixed + index]);
    if (type.containsGenericParameters || type.name === 'System.Void') {
      throw new ManagedFault('InvalidProgramException', 'Invalid optional argument type');
    }
    const slot = locals.length;
    locals.push(sourceStore(vm, value, type, types[fixed + index]));
    vm.heap.pins.push(locals[slot]);
    return {type, index: slot};
  });
}
