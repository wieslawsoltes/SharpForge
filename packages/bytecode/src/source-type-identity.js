const maxDepth = 64;
const maxNodes = 4096;
const maxText = 65536;

function fail() {
  throw new TypeError('Invalid source type identity');
}

function ownRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length !== keys.length || keys.some(key => !properties[key] || !('value' in properties[key]))) fail();
}

function copyIdentity(value, budget, depth) {
  if (depth > maxDepth || --budget.nodes < 0) fail();
  if (Object.hasOwn(value ?? {}, 'element')) {
    ownRecord(value, ['element', 'rank', 'vector']);
    if (!Number.isInteger(value.rank) || value.rank < 1 || value.rank > 32 ||
        typeof value.vector !== 'boolean' || value.vector && value.rank !== 1) fail();
    return Object.freeze({element: copyIdentity(value.element, budget, depth + 1), rank: value.rank, vector: value.vector});
  }
  ownRecord(value, ['name', 'assembly', 'arguments']);
  if (typeof value.name !== 'string' || !value.name || value.name.length > 1024 || /[\[\],*&\0]/.test(value.name) ||
      !['source', 'core'].includes(value.assembly) || !Array.isArray(value.arguments) || value.arguments.length > 64) fail();
  budget.text -= value.name.length;
  if (budget.text < 0) fail();
  let arity = 0;
  for (const part of value.name.split(/[.+]/)) {
    if (!part) fail();
    const index = part.indexOf('`');
    if (index < 0) continue;
    const suffix = part.slice(index + 1);
    if (!index || !/^[1-9]\d*$/.test(suffix) || Number(suffix) > 64) fail();
    arity += Number(suffix);
  }
  if (arity !== value.arguments.length) fail();
  return Object.freeze({name: value.name, assembly: value.assembly,
    arguments: Object.freeze(value.arguments.map(argument => copyIdentity(argument, budget, depth + 1)))});
}

/** Copy/freeze one closed logical type descriptor; depth, node and name budgets reject malformed input. */
export function copySourceTypeIdentity(value) {
  return copyIdentity(value, {nodes: maxNodes, text: maxText}, 0);
}

/** Return validated construction identities indexed by their unchanged physical source owner names. */
export function sourceTypeIdentities(types) {
  const identities = new Map();
  const names = new Set();
  const physicalNames = new Set(types.map(type => type.name));
  const budget = {nodes: 131072, text: 4 * 1024 * 1024};
  for (const type of types) {
    if (type.sourceIdentity === undefined) continue;
    const identity = copyIdentity(type.sourceIdentity, budget, 0);
    if (identity.element || identity.assembly !== 'source' || !identity.arguments.length ||
        typeof type.name !== 'string' || identities.has(type.name) || physicalNames.has(identity.name)) fail();
    const key = JSON.stringify(identity);
    if (names.has(key)) throw new TypeError('Duplicate source type identity');
    names.add(key);
    identities.set(type.name, identity);
  }
  return identities;
}

/** Report additive source identity schema errors through the ordinary source-image verifier. */
export function verifySourceTypeIdentities(types, failImage) {
  try {
    sourceTypeIdentities(types);
  } catch (error) {
    failImage(null, 0, error.message);
  }
}
