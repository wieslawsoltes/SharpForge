import {ConstrainedObjectProfile, ConstrainedReferenceObjectProfile} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {isAggregateType} from './value-types.js';
import {validateGenericArguments} from './generic-constraints.js';
import {sourceObjectOverride} from './source-object-slots.js';

const profiles = new WeakMap();

function profileFor(vm) {
  const epoch = executionCodeState(vm);
  let profile = profiles.get(epoch);
  if (!profile) {
    profile = {objects: new ConstrainedObjectProfile(vm.inspector), references: null};
    profiles.set(epoch, profile);
  }
  return profile;
}

function references(vm, profile = profileFor(vm)) {
  return profile.references ??= new ConstrainedReferenceObjectProfile(vm.inspector, profile.objects, vm.typeSystem.dispatch);
}

export function constrainedInt32Plan(vm, token, descriptor) {
  return profileFor(vm).objects.int32(token, descriptor);
}

export function constrainedPrimitivePlan(vm, token, descriptor) {
  return profileFor(vm).objects.primitive(token, descriptor);
}

export function constrainedObjectPlan(vm, table, descriptor) {
  if (!isAggregateType(table) || table.flags.nullable || table.containsGenericParameters) return null;
  return profileFor(vm).objects.select(table.definitionToken, descriptor);
}

export function constrainedReferenceObjectPlan(vm, table, descriptor) {
  if (table.flags.valueType || table.flags.interface || table.containsGenericParameters) return null;
  const profile = profileFor(vm);
  if (!profile.objects.declaration(descriptor)) return null;
  if (table.name === 'System.Object' || table.name === 'System.String') return {target: null};
  return references(vm, profile).select(table.definitionToken, descriptor);
}

/** Runtime field dispatch selects the exact inherited Object slot, including a closed generic owner. */
export function objectOverride(vm, table, name) {
  // Enum boxes inherit the scalar System.Enum contracts, not the user-struct layout profile.
  if (table.flags.enum) return null;
  if (!vm.inspector) return sourceObjectOverride(vm, table, name);
  if (!vm.typeSystem.types.has(table.definitionToken)) return null;
  if (table.containsGenericParameters) throw new ManagedFault('InvalidProgramException', 'Object receiver requires a closed type');
  const profile = profileFor(vm);
  const plan = table.flags.valueType ? profile.objects.slot(table.definitionToken, name)
    : references(vm, profile).plan(table.definitionToken, 0, name);
  if (!plan) throw new ManagedFault('NotSupportedException', 'Object receiver has an unsupported value layout or reference hierarchy');
  return plan?.target ?? null;
}

/** Recheck a live symbolic substitution; cached code descriptors cannot grant invalid generic constraints. */
export function requireConstrainedObjectBound(vm, caller, token, table) {
  const profile = profileFor(vm), bound = references(vm, profile).genericBound(caller.method, token);
  if (bound && !vm.typeSystem.castCache.isAssignableFrom(vm.typeSystem.table(bound), table)) {
    throw new ManagedFault('InvalidProgramException', 'Constrained generic context violates its declared base-class bound');
  }
  const method = caller.method;
  const context = {typeArguments: method.typeArguments ?? [], methodArguments: method.methodArguments ?? []};
  try {
    validateGenericArguments(vm, method.ownerToken, context.typeArguments, context);
    validateGenericArguments(vm, method.token, context.methodArguments, context);
  } catch (error) {
    if (error.name !== 'ArgumentException') throw error;
    throw new ManagedFault('InvalidProgramException', 'Constrained generic context violates its declared constraints');
  }
}
