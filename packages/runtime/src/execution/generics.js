import {genericTypeParts, instantiateSignature, substituteCallType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {validateGenericArguments} from './generic-constraints.js';

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
  const {original, token, ownerName, typeArguments, methodArguments} = entry;
  const arity = original.signature.genericArity ?? 0;
  if (arity !== methodArguments.length) invalid('Generic method requires a complete instantiation');
  const context = {typeArguments, methodArguments};
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

/** Explicit VM-owned cache. Nested Maps key by MethodDef and MethodTable handles. */
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

  get(vm, entry, rejectDuplicate = false) {
    const existing = this.node(entry)?.get('method');
    if (existing) {
      if (rejectDuplicate) throw new TypeError('Duplicate generic instantiation tuple');
      return existing;
    }
    if (this.entries.size >= this.limit) invalid('Generic instantiation cache limit exceeded');
    const method = makeMethod(vm, entry);
    this.node(entry, true).set('method', method);
    this.entries.set(method, [entry.token, entry.ownerName, [...entry.methodArguments]]);
    return method;
  }
}

function cacheFor(vm) {
  if (vm.genericInstantiations?.inspector !== vm.inspector) {
    vm.genericInstantiations = new GenericInstantiations(vm);
  }
  return vm.genericInstantiations;
}

/** Resolve a closed method; reference instantiations share the canonical IL body. */
export function instantiatedMethod(vm, token, genericIdentity = null, methodArguments = []) {
  return cacheFor(vm).get(vm, instantiation(vm, token, genericIdentity, methodArguments));
}

/** Portable state is ordered [MethodDef token, closed owner name|null, argument names[]]. */
export function captureGenericInstantiations(vm) {
  return [...cacheFor(vm).entries.values()].map(([token, owner, arguments_]) => [token, owner, [...arguments_]]);
}

export function prepareGenericInstantiations(vm, tuples) {
  if (!Array.isArray(tuples) || tuples.length > limitFor(vm)) throw new TypeError('Invalid generic instantiation list');
  const cache = new GenericInstantiations(vm);
  for (const tuple of tuples) {
    if (!Array.isArray(tuple) || tuple.length !== 3) throw new TypeError('Invalid generic instantiation tuple');
    const [token, owner, arguments_] = tuple;
    cache.get(vm, instantiation(vm, token, owner, arguments_), true);
  }
  return cache;
}

/** Preflight metadata and constraints without changing the live instantiation cache. */
export function validateGenericInstantiations(vm, tuples) {
  prepareGenericInstantiations(vm, tuples);
}

/** Atomically rebuild captured entries before portable frame methods are rehydrated. */
export function restoreGenericInstantiations(vm, tuples) {
  const prepared = prepareGenericInstantiations(vm, tuples);
  vm.genericInstantiations = prepared;
}
