import {createHash} from 'node:crypto';
import * as modules from 'node:module';

// Only the isolated qualification child imports this module. Product code has no observer or counter branch.
export const floatAllocationCounter = {objects: 0};
export const floatAllocationCounterSupported = typeof modules.registerHooks === 'function';
const allocation = "  return Object.freeze({float: kind, value: kind === 'r4' ? Math.fround(value) : Number(value)});";
const hash = text => createHash('sha256').update(text).digest('hex');

/** Fail closed if the reviewed float factory changes; never instrument an approximate textual match. */
export function instrumentFloatFactory(source, counterURL = import.meta.url) {
  if (source.split(allocation).length !== 2 || source.includes('__a05FloatAllocationCounter')) {
    throw new Error('The float factory allocation site needs review before instrumentation');
  }
  const prefix = `import {floatAllocationCounter as __a05FloatAllocationCounter} from ${JSON.stringify(counterURL)};\n`;
  const after = prefix + source.replace(allocation, '  __a05FloatAllocationCounter.objects++;\n' + allocation);
  return {source: after, beforeSHA256: hash(source), afterSHA256: hash(after), allocationSites: 1};
}

/** Install before dynamically importing any product package; module caching otherwise invalidates the count. */
export function registerFloatAllocationCounter() {
  if (!floatAllocationCounterSupported) {
    throw Object.assign(new Error('Exact float instrumentation requires Node module.registerHooks (22.15 or newer)'),
      {code: 'FLOAT_INSTRUMENTATION_UNSUPPORTED'});
  }
  const target = new URL('../../packages/bytecode/src/numeric/float.js', import.meta.url).href;
  let manifest = null;
  const hooks = modules.registerHooks({load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== target) return loaded;
    if (manifest) throw new Error('Float instrumentation unexpectedly loaded its target twice');
    const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
    const transformed = instrumentFloatFactory(source);
    manifest = {path: 'packages/bytecode/src/numeric/float.js', beforeSHA256: transformed.beforeSHA256,
      afterSHA256: transformed.afterSHA256, allocationSites: transformed.allocationSites};
    return {...loaded, source: transformed.source};
  }});
  return {finish() {
    hooks.deregister();
    if (!manifest) throw new Error('Float factory was cached or not loaded; allocation count is invalid');
    return manifest;
  }};
}
