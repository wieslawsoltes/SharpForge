import {fail, invokeBclModules} from '@sharpforge/bcl-core';
import {writerScalarTypes} from './string-writer-scalars.js';

const owner = 'System.Text.StringBuilder';
const constructor = Object.freeze({owner, name: '.ctor', kind: 'constructor', parameters: [], isStatic: false});
const append = Object.freeze({owner, name: 'Append', kind: 'method', parameters: ['string'], isStatic: false});
const scalarAppends = new Map(writerScalarTypes.map(type => [type, Object.freeze({
  owner, name: 'Append', kind: 'method', parameters: Object.freeze([type]), isStatic: false
})]));
const toString = Object.freeze({owner, name: 'ToString', kind: 'method', parameters: [], isStatic: false});
const length = Object.freeze({owner, name: 'get_Length', kind: 'get', parameters: [], isStatic: false});

function invoke(platform, descriptor, args) {
  // The core constructor may add temporary roots; keep them scoped to this nested dispatch.
  return platform.heap.withRoots(args, () => {
    const result = invokeBclModules(platform, descriptor, args);
    if (!result.handled) fail(platform, 'MissingMethodException', 'StringBuilder.' + descriptor.name);
    return result.value;
  });
}

/** Construct the ordinary managed StringBuilder through the public core module registry. */
export function createWriterBuilder(platform) {
  return invoke(platform, constructor, []);
}

/** Append UTF-16 text with the existing builder's growth, notifications and host bounds. */
export function appendWriterBuilder(platform, reference, value) {
  invoke(platform, append, [reference, value]);
}

/** Append an exact typed scalar using a cached core descriptor and the existing default formatter. */
export function appendWriterScalar(platform, reference, value, type) {
  const descriptor = scalarAppends.get(type);
  if (!descriptor) fail(platform, 'MissingMethodException', 'StringBuilder.Append(' + type + ')');
  invoke(platform, descriptor, [reference, value]);
}

/** Materialize the shared builder's current contents, including external mutations. */
export function writerBuilderText(platform, reference) {
  return invoke(platform, toString, [reference]);
}

/** Read the public builder length before materializing a bounded character-buffer write. */
export function writerBuilderLength(platform, reference) {
  return invoke(platform, length, [reference]);
}
