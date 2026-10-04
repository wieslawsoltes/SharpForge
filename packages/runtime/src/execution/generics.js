import {genericTypeParts, instantiateSignature, substituteCallType, isSizeOfOnlyMethod} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {validateGenericArguments} from './generic-constraints.js';
import {managedValueLayout, valueLayout} from './value-layout.js';
import {requireValueStorage} from './value-types.js';

function invalid(message) {
  throw new ManagedFault('InvalidProgramException', message);
}

function limitFor(vm) {
  const limit = vm.options.maxGenericInstantiations ?? 100000;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid generic instantiation limit');
  return limit;
}

function instantiation(vm, token, genericIdentity, methodArguments) {
  if (!Number.isSafeInteger(token) || token >>> 24 !== 6 || !vm.inspector.methods.has(token)) {
    invalid('Instantiation requires a MethodDef token');
  }
  if (genericIdentity !== null && typeof genericIdentity !== 'string' ||
      !Array.isArray(methodArguments) || methodArguments.some(type => typeof type !== 'string')) {
    invalid('Invalid generic instantiation context');
  }
  const original = vm.inspector.getMethod(token);
  const owner = genericIdentity === null ? null : vm.typeSystem.table(genericIdentity);
  if (owner && (owner.definitionToken !== original.ownerToken || owner.containsGenericParameters)) {
    invalid('Generic owner does not match the method declaration');
  }
  const ownerName = owner?.name ?? null;
  const typeArguments = genericTypeParts(ownerName ?? '').arguments;
  const methodHandles = methodArguments.map(type => vm.typeSystem.table(type));
  return {original, token, owner, ownerName, typeArguments, methodHandles,
    methodArguments: methodHandles.map(type => type.name)};
}

function makeMethod(vm, entry) {
  const {original, token, owner, ownerName, typeArguments, methodArguments} = entry;
  const arity = original.signature.genericArity ?? 0;
  if (arity !== methodArguments.length) invalid('Generic method requires a complete instantiation');
  const layoutOnly = isSizeOfOnlyMethod(vm.inspector, token);
  if (owner?.flags.valueType && !owner.flags.primitive && !owner.flags.enum) {
    if (layoutOnly) valueLayout(vm, owner);
    else managedValueLayout(vm, owner);
    if (!layoutOnly && !owner.flags.nullable) requireValueStorage(vm, owner);
  }
  const context = {typeArguments, methodArguments, layoutOnly};
  validateGenericArguments(vm, original.ownerToken, typeArguments, context);
  validateGenericArguments(vm, token, methodArguments, {...context, arity});
  const signature = instantiateSignature(original.signature, typeArguments, methodArguments);
  const locals = original.locals.map(type => substituteCallType(type, typeArguments, methodArguments));
  if (signature.parameters.concat(signature.returnType, locals).some(type => /!!?\d+/.test(type))) {
    invalid('Open generic code is not executable');
  }
  // All instantiations retain the canonical immutable body and offset indexes.
  // Concrete signatures/layout handles remain specific to this generic context.
  return {...original, signature, locals, typeArguments: Object.freeze(typeArguments),
    genericIdentity: ownerName, methodArguments: Object.freeze(methodArguments)};
}

/** Derived code-epoch cache. Nested Maps key by MethodDef and MethodTable handles. */
export class GenericInstantiations {
  constructor(vm) {
    this.inspector = vm.inspector;
    this.limit = limitFor(vm);
    this.methods = new Map();
    this.entries = new Map();
  }

  node(entry, create = false) {
    let map = this.methods;
    for (const key of [entry.token, entry.owner, ...entry.methodHandles]) {
      let next = map.get(key);
      if (!next && !create) return null;
      if (!next) map.set(key, next = new Map());
      map = next;
    }
    return map;
  }

  get(vm, entry) {
    const existing = this.node(entry)?.get('method');
    if (existing) return existing;
    if (this.entries.size >= this.limit) invalid('Generic instantiation cache limit exceeded');
    const method = makeMethod(vm, entry);
    this.node(entry, true).set('method', method);
    this.entries.set(method, [entry.token, entry.ownerName, [...entry.methodArguments]]);
    return method;
  }
}

function cacheFor(vm) {
  vm.typeSystem;
  const state = executionCodeState(vm);
  return state.generics ??= new GenericInstantiations(vm);
}

/** Resolve a closed method; reference instantiations share the canonical IL body. */
export function instantiatedMethod(vm, token, genericIdentity = null, methodArguments = []) {
  const original = vm.inspector.getMethod(token);
  if (genericIdentity === null && !methodArguments.length && !original.signature.genericArity &&
      !vm.typeSystem.table(original.ownerToken).genericArity) return original;
  const cache = cacheFor(vm);
  return cache.get(vm, instantiation(vm, token, genericIdentity, methodArguments));
}
