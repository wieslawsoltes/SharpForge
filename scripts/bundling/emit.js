export const bundleMarker = '/* SharpForge static module bundle v2. Generated without runtime code compilation. */';

function prefixFor(modules) {
  let prefix = '__sharpforgeBundle';
  while (modules.some(module => module.source.includes(prefix))) prefix += '$';
  return prefix;
}

function moduleBody(module, prefix) {
  const load = `${prefix}Load`, prelude = [], replacements = [];
  for (const record of module.syntax) {
    let text = '';
    if (record.kind === 'dynamic') text = record.unavailable
      ? `Promise.reject(new Error(${JSON.stringify(`${record.unavailable} is not available in a browser bundle`)}))`
      : `Promise.resolve().then(() => ${load}(${record.id}))`;
    else if (record.kind === 'static') {
      if (record.namespace) prelude.push(`const ${record.namespace} = ${load}(${record.id});`);
      else if (record.bindings.length) {
        const bindings = record.bindings.map(binding => `${binding.name}:${binding.alias}`).join(',');
        prelude.push(`const {${bindings}} = ${load}(${record.id});`);
      } else prelude.push(`${load}(${record.id});`);
    } else if (record.kind === 'reexport') prelude.push(`${load}(${record.id});`);
    else if (record.kind === 'worker') text = record.asset;
    replacements.push({ start: record.start, end: record.end, text });
  }
  let source = module.source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  }
  const properties = [...module.exports].filter(([, value]) => value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, value]) => {
    const expression = value.local ?? `${load}(${value.id})[${JSON.stringify(value.name)}]`;
    return `[${JSON.stringify(name)}]: {enumerable: true, get() { return ${expression}; }}`;
  });
  const descriptors = `[Symbol.toStringTag]: {value: 'Module'},${properties.join(',')}`;
  return `function() {\n${prelude.join('\n')}\n${source}\n`
    + `return Object.freeze(Object.defineProperties(Object.create(null), {${descriptors}}));\n}`;
}

/** Memoized module evaluation preserves first-use errors, shared identity, and microtask-deferred imports. */
export function emitBundle({ modules, entryId }) {
  const prefix = prefixFor(modules);
  const bodies = modules.map(module => moduleBody(module, prefix));
  return `${bundleMarker}
'use strict';
(() => {
const ${prefix}Factories = [${bodies.join(',\n')}];
const ${prefix}Values = [], ${prefix}Errors = [], ${prefix}States = [];
function ${prefix}Load(id) {
  if (${prefix}States[id] === 2) return ${prefix}Values[id];
  if (${prefix}States[id] === 3) throw ${prefix}Errors[id];
  if (${prefix}States[id] === 1) throw new Error('Circular module evaluation: ' + id);
  ${prefix}States[id] = 1;
  try {
    const value = (0, ${prefix}Factories[id])();
    ${prefix}Values[id] = value;
    ${prefix}States[id] = 2;
    return value;
  } catch (error) {
    ${prefix}Errors[id] = error;
    ${prefix}States[id] = 3;
    throw error;
  }
}
${prefix}Load(${entryId});
})();
`;
}
