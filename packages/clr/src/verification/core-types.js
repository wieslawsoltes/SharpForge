import { RuntimeModule } from '../assembly.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const unprepared = Object.freeze({ status: 'unknown', reason: 'unprepared-core-binding' });
const outside = Object.freeze({ status: 'unknown', reason: 'outside-core-module' });
const invalid = message => loadError(LoadErrorCode.InvalidConfiguration, message);

function requireToken(module, token, definitionOnly = false) {
  if (!Number.isInteger(token) || token < 0 || token > 0xffffffff ||
      (token >>> 24 !== 2 && (definitionOnly || token >>> 24 !== 1)) ||
      !(token & 0xffffff) || (token & 0xffffff) > module.rowCount(token >>> 24)) {
    throw invalid('Core binding requires an existing TypeDef or TypeRef token');
  }
}

function canonicalResult(context, module, token) {
  const result = context.resolveType(token);
  if (result?.status === 'unknown' && typeof result.reason === 'string' && result.reason.length <= 256) {
    return Object.freeze({ status: 'unknown', reason: result.reason });
  }
  const type = result?.value;
  if (result?.status !== 'known' || !type || type.kind !== 'definition' || type.token !== token ||
      !Object.isFrozen(type) || type.flags !== module.row(token)[0] || type.isInterface !== !!(type.flags & 0x20)) {
    throw invalid('Core context must return its canonical metadata definition');
  }
  return Object.freeze({ status: 'known', value: type });
}

function prepareOptions(module, options) {
  const { coreModule, context, tokens, maxBindings = 4096, signal } = options;
  checkCancellation(signal);
  if (!(module instanceof RuntimeModule) || !(coreModule instanceof RuntimeModule) ||
      typeof context?.resolveType !== 'function' || typeof context.baseType !== 'function') {
    throw invalid('Input/core runtime modules and a prepared CIL core context are required');
  }
  if (!Number.isSafeInteger(maxBindings) || maxBindings < 0 || maxBindings > 65535) throw invalid('Invalid core binding limit');
  if (!Array.isArray(tokens)) throw invalid('An explicit core binding token array is required');
  const count = tokens.length;
  if (count > maxBindings) throw loadError(LoadErrorCode.LimitExceeded, 'Core binding limit exceeded');
  const pending = new Set();
  for (let index = 0; index < count; index++) {
    checkCancellation(signal);
    const token = tokens[index];
    requireToken(module, token);
    pending.add(token);
  }
  const roots = {};
  const identities = new Set();
  for (const role of ['object', 'valueType', 'enum']) {
    checkCancellation(signal);
    const type = options[role];
    requireToken(coreModule, type?.token, true);
    if (canonicalResult(context, coreModule, type.token).value !== type || identities.has(type)) {
      throw invalid('Distinct canonical CIL core roots are required');
    }
    identities.add(type);
    roots[role] = type;
  }
  return { coreModule, context, pending, signal, roots };
}

/** Prepare a bounded synchronous CIL core authority using existing async CLR binding.
 * The host vouches for the supplied core module/context pairing. Loader errors propagate unchanged;
 * unprepared, non-core and CIL-unsupported definitions remain unknown. No method body is read.
 */
export async function prepareVerificationCoreTypes(module, options = {}) {
  if (!options || typeof options !== 'object') throw invalid('Core binding options are required');
  const { coreModule, context, pending, signal, roots } = prepareOptions(module, options);
  const bindings = new Map();
  const loader = module.assembly.loadContext.types;
  for (const token of pending) {
    checkCancellation(signal);
    const type = await loader.load(module, token, { signal });
    checkCancellation(signal);
    bindings.set(token, type.module === coreModule ? canonicalResult(context, coreModule, type.metadataToken) : outside);
  }
  checkCancellation(signal);
  return Object.freeze({ context, ...roots, sameModule: module === coreModule,
    resolveType: token => bindings.get(token) ?? unprepared });
}
