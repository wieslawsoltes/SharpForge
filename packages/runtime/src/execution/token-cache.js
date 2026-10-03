import {executionCodeState} from './code-version.js';

function cacheFor(vm) {
  const state = executionCodeState(vm);
  return state.tokens ??= {
    raw: new Map(), strings: new Map(), names: new Map(),
    verifiedSource: null, verified: null
  };
}

// Inspector descriptors contain metadata values only. Copy their nested signatures
// so callers cannot mutate the shared inspector or a later cache hit.
function immutableMetadata(value) {
  if (value === null || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? value.map(immutableMetadata)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableMetadata(item)]));
  return Object.freeze(copy);
}

/** Cache unresolved metadata, without substituting caller-specific generic arguments. */
export function cachedMetadataToken(vm, token) {
  const entries = cacheFor(vm).raw;
  if (!entries.has(token)) entries.set(token, immutableMetadata(vm.inspector.resolveToken(token)));
  return entries.get(token);
}

export function cachedTypeName(vm, token) {
  const entries = cacheFor(vm).names;
  if (!entries.has(token)) entries.set(token, vm.inspector.metadata.typeName(token));
  return entries.get(token);
}

/** Retain decoded UTF-16 text, never an interned managed handle or heap record. */
export function cachedUserString(vm, token) {
  const entries = cacheFor(vm).strings;
  if (!entries.has(token)) entries.set(token, vm.inspector.metadata.userString(token));
  return entries.get(token);
}

/** Replace the linear verified-method membership scan on warm calls. */
export function verifiedMethod(vm, token) {
  const cache = cacheFor(vm);
  if (cache.verifiedSource !== vm.report.methods) {
    cache.verifiedSource = vm.report.methods;
    cache.verified = new Set(vm.report.methods);
  }
  return cache.verified.has(token);
}
