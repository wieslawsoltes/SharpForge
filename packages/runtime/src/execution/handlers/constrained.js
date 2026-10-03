import {callSignatureKey} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../../heap.js';
import {resolveCallType} from '../generic-calls.js';
import {validatePointer, pointerType} from '../managed-pointers.js';
import {boxValue} from '../value-types.js';

const objectMembers = new Set(['ToString', 'GetHashCode', 'Equals']);
const objectOwners = new Set(['System.Object', 'System.ValueType', 'System.Enum']);

/** Cache a receiver's overrides by signature; ordinary calls never scan its base chain. */
export function objectOverride(vm, descriptor, receiver) {
  if (!objectOwners.has(descriptor.owner) || !objectMembers.has(descriptor.name)) return null;
  let table = receiver?.byref ? pointerType(vm, receiver) : isReference(receiver) ? vm.heap.get(receiver).methodTable : null;
  if (!table) return null;
  const typeSystem = vm.typeSystem;
  typeSystem.objectOverrides ??= new Map();
  let methods = typeSystem.objectOverrides.get(table);
  if (!methods) {
    methods = new Map();
    for (let current = table; current; current = current.base) {
      for (const method of typeSystem.types.get(current.definitionToken)?.methods ?? []) {
        if (!(method.flags & 0x40) || method.flags & 0x10 || !objectMembers.has(method.name)) continue;
        const signature = vm.inspector.signature(method.token);
        const key = method.name + ':' + callSignatureKey(signature);
        if (!methods.has(key)) methods.set(key, {method, ownerInstance: current.typeArguments.length ? current.name : null});
      }
    }
    typeSystem.objectOverrides.set(table, methods);
  }
  const target = methods.get(descriptor.name + ':' + callSignatureKey(descriptor.signature));
  return target ? {...descriptor, ...target.method, resolvedToken: target.method.token, ownerInstance: target.ownerInstance} : null;
}

/** ECMA-335 III.2.1: pass value-type overrides their original address, box only the inherited fallback. */
export function constrainedTarget(vm, descriptor, args, type) {
  const receiver = args[0];
  validatePointer(vm, receiver);
  const table = vm.typeSystem.table(resolveCallType(vm, type));
  if (pointerType(vm, receiver) !== table) {
    throw new ManagedFault('InvalidProgramException', 'constrained. receiver type mismatch');
  }
  if (!table.flags.valueType) {
    args[0] = vm.dereference(receiver);
    return descriptor;
  }
  const ownOverride = objectOverride(vm, descriptor, receiver);
  if (ownOverride && vm.typeSystem.table(ownOverride.ownerToken).flags.valueType) return ownOverride;
  const external = descriptor.resolvedToken ? null : vm.typeSystem.dispatch.externalTarget(table.name, descriptor);
  const target = descriptor.resolvedToken ?? external;
  if (target) {
    const resolved = external ?? vm.typeSystem.dispatch.resolve(table.name, target, descriptor.ownerInstance);
    const method = vm.inspector.methods.get(resolved);
    if (method && vm.typeSystem.table(method.ownerToken).flags.valueType) {
      return {...descriptor, ...method, resolvedToken: resolved, ownerInstance: table.typeArguments.length ? table.name : null};
    }
  }
  args[0] = boxValue(vm, vm.dereference(receiver), table.name);
  return descriptor;
}

export const handlers = new Map([
  ['constrained.', (vm, frame, instruction) => { frame.constrainedType = instruction.operand; }]
]);
