import {PropertyFault} from '../../property/values.js';

export const COMPILED_BINDING_VERSION = 1;
const modes = new Set(['OneTime', 'OneWay', 'TwoWay']);
const kinds = new Set(['property', 'event', 'load']);
const contextNames = new Set(['value', 'sender', 'eventArgs', 'converter', 'parameter', 'language', 'targetType', 'sourceType']);

function fail(message) { throw new PropertyFault('ArgumentException', `SFXB001: ${message}`); }
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('An object descriptor is required');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown descriptor field '${key}'`);
}
function token(value) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) fail('A nonzero uint32 metadata token is required');
}

/** Copy only bounded plain data; descriptor getters and executable values are rejected before evaluation. */
function copyData(value, state, depth = 0) {
  if (++state.nodes > state.maxNodes || depth > state.maxDepth) fail('Descriptor data budget exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= state.maxString) return value;
  if (!value || typeof value !== 'object') fail('Descriptor contains a non-data value');
  if (state.seen.has(value)) fail('Descriptor data must not contain cycles');
  const array = Array.isArray(value);
  if (Object.getOwnPropertySymbols(value).length) fail('Descriptor symbols are not allowed');
  if (array && Object.getPrototypeOf(value) !== Array.prototype) fail('Plain descriptor arrays are required');
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('Plain descriptor data required');
  if (array && value.length > state.maxNodes) fail('Descriptor array budget exceeded');
  if (array && Object.keys(value).length !== value.length) fail('Descriptor arrays must be dense');
  state.seen.add(value);
  const result = array ? [] : Object.create(null);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && name === 'length') continue;
    if (array && (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= value.length)) fail('Descriptor arrays cannot have named fields');
    if (!Object.hasOwn(descriptor, 'value')) fail('Descriptor accessors are not allowed');
    if (name === '__proto__' || name === 'prototype' || name === 'constructor') fail('Unsafe descriptor field');
    result[name] = copyData(descriptor.value, state, depth + 1);
  }
  state.seen.delete(value);
  return Object.freeze(result);
}

function expression(value, state, depth = 0) {
  if (depth > state.maxDepth) fail('Expression nesting exceeded');
  if (!value || typeof value.kind !== 'string') fail('Expression kind is required');
  if (value.kind === 'constant') {
    keys(value, ['kind', 'value']);
    if (!Object.hasOwn(value, 'value') || value.value !== null && !['string', 'number', 'boolean'].includes(typeof value.value)) {
      fail('Only scalar expression constants are supported');
    }
  } else if (value.kind === 'context') {
    keys(value, ['kind', 'name']);
    if (!contextNames.has(value.name)) fail('Unknown contextual expression');
  } else if (value.kind === 'path') {
    keys(value, ['kind', 'steps', 'root']);
    if (!Array.isArray(value.steps) || value.steps.length > state.maxSteps) fail('Invalid token path');
    if (value.root) expression(value.root, state, depth + 1);
    for (const step of value.steps) {
      keys(step, ['token', 'nullConditional', 'typeToken', 'arguments']);
      token(step.token);
      if (step.typeToken !== undefined) token(step.typeToken);
      if (step.nullConditional !== undefined && typeof step.nullConditional !== 'boolean') fail('Invalid null-conditional flag');
      if (step.arguments !== undefined) {
        if (!Array.isArray(step.arguments) || step.arguments.length > 32) fail('Invalid indexer arguments');
        for (const argument of step.arguments) expression(argument, state, depth + 1);
      }
    }
  } else if (value.kind === 'cast') {
    keys(value, ['kind', 'token', 'value']);
    token(value.token);
    expression(value.value, state, depth + 1);
  } else if (value.kind === 'call') {
    keys(value, ['kind', 'token', 'receiver', 'arguments', 'nullConditional']);
    token(value.token);
    if (value.receiver !== null && value.receiver !== undefined) expression(value.receiver, state, depth + 1);
    if (!Array.isArray(value.arguments) || value.arguments.length > 32) fail('Invalid compiled call arguments');
    if (value.nullConditional !== undefined && typeof value.nullConditional !== 'boolean') fail('Invalid null-conditional call flag');
    for (const argument of value.arguments) expression(argument, state, depth + 1);
  } else fail(`Unsupported expression kind '${value.kind}'`);
}

/** Validate the versioned token-only compiler/runtime contract and return an immutable private copy. */
export function validateCompiledBindingDescriptor(descriptor, options = {}) {
  const state = {maxNodes: 4096, maxDepth: 32, maxString: 16384, maxSteps: 128, ...options, nodes: 0, seen: new Set()};
  for (const [name, maximum] of [['maxNodes', 1000000], ['maxDepth', 64], ['maxString', 1000000], ['maxSteps', 4096]]) {
    if (!Number.isSafeInteger(state[name]) || state[name] < 1 || state[name] > maximum) fail('Invalid descriptor budget');
  }
  const value = copyData(descriptor, state);
  keys(value, ['version', 'kind', 'mode', 'target', 'expression', 'converter', 'convertBack', 'bindBack', 'phase', 'sourceType', 'targetType']);
  if (value.version !== COMPILED_BINDING_VERSION || !kinds.has(value.kind)) fail('Unsupported descriptor version or kind');
  if (value.mode !== undefined && !modes.has(value.mode)) fail('Unknown compiled binding mode');
  keys(value.target, ['id', 'token', 'name']);
  if (typeof value.target.id !== 'string' || !value.target.id || value.target.id.length > 1024) fail('Target identity is required');
  if (value.kind !== 'load') token(value.target.token);
  else if (typeof value.target.name !== 'string' || !value.target.name || value.target.name.length > 1024) {
    fail('A bounded deferred element name is required');
  }
  if (value.phase !== undefined && (!Number.isInteger(value.phase) || value.phase < 0 || value.phase > 1024)) fail('Invalid binding phase');
  if (value.sourceType !== undefined) token(value.sourceType);
  if (value.targetType !== undefined) token(value.targetType);
  expression(value.expression, state);
  if (value.converter) expression(value.converter, state);
  if (value.convertBack) expression(value.convertBack, state);
  if (value.bindBack) expression(value.bindBack, state);
  if (value.kind === 'event' && value.expression.kind !== 'call') fail('An event descriptor must invoke a metadata-token method');
  if (value.bindBack && value.mode !== 'TwoWay') fail('BindBack requires TwoWay mode');
  if (value.convertBack && value.mode !== 'TwoWay') fail('ConvertBack requires TwoWay mode');
  if (value.bindBack && value.bindBack.kind !== 'call') fail('BindBack must invoke a metadata-token method');
  if (value.mode === 'TwoWay' && !value.bindBack && (value.expression.kind !== 'path' || !value.expression.steps.length)) {
    fail('TwoWay requires a writable token path or BindBack');
  }
  if (value.kind !== 'property' && value.mode === 'TwoWay') fail('Only property bindings support TwoWay mode');
  return value;
}
