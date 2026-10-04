import {InstanceCalliTargets} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {ownsHeapReference} from './heap-reference.js';

const targets = new WeakMap();

/** Share the selected body eligibility between typed local storage and actual calls. */
export function requireInstanceCalliTarget(vm, token, declaration = false) {
  const epoch = executionCodeState(vm);
  let profile = targets.get(epoch);
  if (!profile) targets.set(epoch, profile = new InstanceCalliTargets(vm.inspector));
  if (!(declaration ? profile.acceptsDeclaration(token) : profile.accepts(token))) {
    throw new ManagedFault('NotSupportedException', 'Instance calli requires a nongeneric internal reference-class method');
  }
}

/** Validate all receiver facts while the original operands still own their roots. */
export function requireInstanceCalliReceiver(vm, token, receiver, declaration = false) {
  requireInstanceCalliTarget(vm, token, declaration);
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Null instance calli receiver');
  if (!ownsHeapReference(vm.heap, receiver)) {
    throw new ManagedFault('InvalidProgramException', 'Instance calli requires an allocated receiver from this heap');
  }
  const types = vm.typeSystem;
  const actual = vm.heap.get(receiver).methodTable;
  if (actual.flags.valueType || actual.flags.interface || actual.genericArity ||
      actual.typeArguments.length || actual.containsGenericParameters || !types.types.has(actual.definitionToken)) {
    throw new ManagedFault('NotSupportedException', 'Instance calli requires a nongeneric internal reference-class receiver');
  }
  const owner = types.table(vm.inspector.methods.get(token).ownerToken);
  if (!types.castCache.isAssignableFrom(owner, actual)) {
    throw new ManagedFault('InvalidProgramException', 'Instance calli receiver is incompatible with the selected method');
  }
  return actual;
}
