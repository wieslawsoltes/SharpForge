import {createBclRegistry} from './registry.js';
import {bclModules} from './modules.js';

export {createBclRegistry} from './registry.js';
export {bclModules} from './modules.js';
export {MAX, fail, integer, bclScalar, typeOf, text, string, bounded, array, makeArray, equal, nativeEqual} from './host.js';
export {resolveStringComparer} from './system/string-comparer.js';
export {createHostStringOrdering, defaultStringOrdering} from './globalization/string-ordering.js';
export {formatBclValue} from './formatting/index.js';
export {formatDoubleDefault} from './formatting/index.js';
export {compositeFormat} from './formatting/index.js';
export {invokeLegacyBclBuiltin, hasLegacyBclBuiltin, legacyBclBuiltinNames} from './legacy-builtins.js';

const registry = createBclRegistry(bclModules);
/** Register a selected released group or all modules into the caller's registry. */
export function registerBclModules(target, options) {
  return registry.register(target, options);
}
/** Dispatch a registered family; a supplied type reuses the caller's owner lookup. */
export function invokeBclModules(platform, descriptor, args, type) {
  return registry.invoke(platform, descriptor, args, type);
}
