import {resolveExecutionField, resolveExecutionMethod, genericTypeParts} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';

function cacheFor(vm) {
  const state = executionCodeState(vm);
  return state.tokens ??= {
    raw: new Map(), strings: new Map(), names: new Map(), methods: new WeakMap(), fields: new WeakMap(),
    plainMethods: new Map(), plainFields: new Map(), verifiedSource: null, verified: null
  };
}

function entriesFor(contexts, plain, context) {
  if (!context) return plain;
  let entries = contexts.get(context);
  if (!entries) contexts.set(context, entries = new Map());
  return entries;
}

function immutableDescriptor(descriptor) {
  const copy = {...descriptor};
  if (descriptor.signature) {
    copy.signature = Object.freeze({...descriptor.signature,
      ...(descriptor.signature.parameters ? {parameters: Object.freeze([...descriptor.signature.parameters])} : {})});
  }
  for (const name of ['genericArguments', 'methodArguments', 'typeArguments']) {
    if (Array.isArray(copy[name])) copy[name] = Object.freeze([...copy[name]]);
  }
  return Object.freeze(copy);
}

/** Cache metadata only. Every managed receiver is still validated by the access operation. */
export function cachedMetadataToken(vm, token) {
  const entries = cacheFor(vm).raw;
  if (!entries.has(token)) entries.set(token, immutableDescriptor(vm.inspector.resolveToken(token)));
  return entries.get(token);
}

export function cachedTypeName(vm, token) {
  const entries = cacheFor(vm).names;
  if (!entries.has(token)) entries.set(token, vm.inspector.metadata.typeName(token));
  return entries.get(token);
}

/** Cache the metadata string, never a GC handle whose lifetime can end on restore. */
export function cachedUserString(vm, token) {
  const entries = cacheFor(vm).strings;
  if (!entries.has(token)) entries.set(token, vm.inspector.metadata.userString(token));
  return entries.get(token);
}

export function cachedMethod(vm, token, frame = vm.top) {
  const cache = cacheFor(vm);
  const entries = entriesFor(cache.methods, cache.plainMethods, frame?.method);
  if (!entries.has(token)) {
    const context = {ownerToken: frame?.method.ownerToken, genericIdentity: frame?.genericIdentity ?? null,
      typeArguments: frame?.method.typeArguments, methodArguments: frame?.methodArguments ?? []};
    entries.set(token, immutableDescriptor(resolveExecutionMethod(vm.inspector, token, context)));
  }
  return entries.get(token);
}

/** Closed receiver tables and concrete caller methods are distinct substitution contexts. */
export function cachedField(vm, token, receiverTable = null, frame = null) {
  if (receiverTable && receiverTable.registry !== vm.heap.methodTables) {
    throw new ManagedFault('InvalidProgramException', 'Field receiver type belongs to another VM');
  }
  const cache = cacheFor(vm);
  const context = receiverTable ?? frame?.method;
  const entries = entriesFor(cache.fields, cache.plainFields, context);
  if (!entries.has(token)) {
    const argumentsList = receiverTable ? receiverTable.typeArguments.map(type => type.name)
      : frame?.method.typeArguments ?? genericTypeParts(frame?.genericIdentity ?? '').arguments;
    const field = immutableDescriptor(resolveExecutionField(vm.inspector, token, argumentsList));
    let index;
    if (receiverTable) {
      index = receiverTable.fields.findIndex(item => item.token === field.resolvedToken);
      if (index < 0 || field.isStatic) throw new ManagedFault('InvalidProgramException', 'Field is not part of this instance');
    }
    entries.set(token, Object.freeze({field, token: field.resolvedToken, ...(receiverTable ? {index} : {})}));
  }
  return entries.get(token);
}

/** Verification membership is generation-owned and constant-time on every warm call. */
export function verifiedMethod(vm, token) {
  const cache = cacheFor(vm);
  if (cache.verifiedSource !== vm.report.methods) {
    cache.verifiedSource = vm.report.methods;
    cache.verified = new Set(vm.report.methods);
  }
  return cache.verified.has(token);
}
