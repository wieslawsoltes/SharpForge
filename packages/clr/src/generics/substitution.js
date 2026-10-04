import { decodeSignature, decodeTypeSignature, encodeSignature, encodeTypeSignature } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const children = Object.freeze({
  primitive: [], class: [], valuetype: [], genericParameter: [],
  pointer: ['element'], byref: ['element'], szarray: ['element'], array: ['element'], pinned: ['element'],
  modreq: ['element'], modopt: ['element'], genericInstance: ['type', 'arguments'], functionPointer: ['signature'],
  field: ['type'], locals: ['types'], methodSpec: ['arguments'], method: ['returnType', 'parameters'], property: ['returnType', 'parameters'],
});
const fail = message => loadError(LoadErrorCode.TypeLoad, message);

function limits(options) {
  const maxDepth = options.maxDepth ?? 64;
  const maxNodes = options.maxNodes ?? 4096;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 256 ||
      !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000000) {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid signature substitution limits');
  }
  return { maxDepth, maxNodes, signal: options.signal };
}

function budget(options) {
  let remaining = options.maxNodes;
  function visit(node, depth = 0) {
    checkCancellation(options.signal);
    if (depth > options.maxDepth || --remaining < 0) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Signature substitution complexity exceeded');
    }
    if (!node || typeof node !== 'object' || !Object.hasOwn(children, node.kind)) {
      throw fail('Invalid signature substitution AST');
    }
    for (const key of children[node.kind]) {
      const value = node[key];
      if (Array.isArray(value)) {
        if (value.length > options.maxNodes) {
          throw loadError(LoadErrorCode.LimitExceeded, 'Signature substitution list limit exceeded');
        }
        for (const item of value) visit(item, depth + 1);
      } else visit(value, depth + 1);
    }
  }
  return visit;
}

function normalize(node, type, options) {
  return type ? decodeTypeSignature(encodeTypeSignature(node, options), options)
    : decodeSignature(encodeSignature(node, options), options);
}

function freezeTree(node, replacements) {
  if (node.kind === 'genericParameter' && replacements?.[node.scope] !== undefined) {
    const arguments_ = replacements[node.scope];
    if (node.index >= arguments_.length) throw fail(`Unbound ${node.scope} generic parameter ${node.index}`);
    // Replacement arguments belong to the caller's scope: substitution is simultaneous, never recursive through arguments.
    return arguments_[node.index];
  }
  if (Object.isFrozen(node)) return node;
  for (const key of children[node.kind]) {
    const value = node[key];
    node[key] = Array.isArray(value)
      ? Object.freeze(value.map(item => freezeTree(item, replacements))) : freezeTree(value, replacements);
  }
  if (node.kind === 'array') {
    Object.freeze(node.sizes);
    Object.freeze(node.lowerBounds);
  }
  return Object.freeze(node);
}

function substitute(input, type, options) {
  const bounds = limits(options);
  try {
    const inputBudget = budget(bounds);
    inputBudget(input);
    const replacements = {};
    for (const scope of ['type', 'method']) {
      const arguments_ = options[`${scope}Arguments`];
      if (arguments_ === undefined) continue;
      if (!Array.isArray(arguments_) || arguments_.length > 1024) throw fail('Generic argument list must contain at most 1024 type ASTs');
      replacements[scope] = Array.from(arguments_, argument => {
        inputBudget(argument);
        return freezeTree(normalize(argument, true, bounds));
      });
    }
    const result = freezeTree(normalize(input, type, bounds), replacements);
    budget(bounds)(result);
    // The codec also rejects context-invalid replacements, such as a void field or a byref array element.
    if (type) encodeTypeSignature(result, bounds);
    else encodeSignature(result, bounds);
    return result;
  } catch (error) {
    checkCancellation(bounds.signal);
    if (typeof error.code === 'string' && error.code.startsWith('SFCLR')) throw error;
    throw fail(`Invalid signature substitution: ${error.message}`);
  }
}

/** Substitute VAR/MVAR in a member/local AST. Omitted argument scopes stay open; provided out-of-range slots fail. */
export function substituteSignature(signature, options = {}) { return substitute(signature, false, options); }

/** Substitute a TypeSpec/constraint AST. Token scopes are preserved verbatim; this does not resolve or instantiate types. */
export function substituteTypeSignature(signature, options = {}) { return substitute(signature, true, options); }
