const integerShapes = new Map([
  ['sbyte', [8, false]], ['byte', [8, true]], ['short', [16, false]], ['ushort', [16, true]],
  ['char', [16, true]], ['int', [32, false]], ['uint', [32, true]], ['long', [64, false]], ['ulong', [64, true]]
]);
const descriptorKeys = new Set(['type', 'isStatic', 'readOnly', 'value', 'addressable', 'assemblies']);
const approvedAssemblies = new Set(['System.Runtime', 'System.Private.CoreLib']);
const defaultAssemblies = Object.freeze(['System.Runtime']);
const scalarText = /^(?:NaN|[-+]?Infinity|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/;

function dataRecord(value) {
  if (value === null || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  if (Object.getOwnPropertySymbols(value).length || entries.some(([, descriptor]) => !Object.hasOwn(descriptor, 'value'))) return null;
  return Object.fromEntries(entries.map(([key, descriptor]) => [key, descriptor.value]));
}

function failure(owner, name, message) {
  throw new TypeError(`Invalid readonly field ${owner}::${name}: ${message}`);
}

function scalarValue(owner, name, type, value) {
  if (type === 'bool' && typeof value === 'boolean') return value;
  value = dataRecord(value);
  if (!value || Object.keys(value).length !== 2 || value.scalar !== type || typeof value.value !== 'string') {
    return failure(owner, name, 'an exact JSON scalar value is required');
  }
  const shape = integerShapes.get(type);
  if (shape) {
    if (value.value.length > 21 || !/^-?(?:0|[1-9]\d*)$/.test(value.value)) {
      return failure(owner, name, 'invalid integral scalar');
    }
    const [width, unsigned] = shape;
    const bits = BigInt(width);
    const raw = BigInt(value.value);
    const minimum = unsigned ? 0n : -(1n << (bits - 1n));
    const maximum = (1n << (unsigned ? bits : bits - 1n)) - 1n;
    if (raw < minimum || raw > maximum) return failure(owner, name, 'integral scalar is out of range');
  } else if (!['float', 'double'].includes(type) || value.value.length > 64 || !scalarText.test(value.value)) {
    return failure(owner, name, 'only Boolean and fixed-width numeric scalars are supported');
  }
  return Object.freeze({scalar: type, value: value.value});
}

function assemblyScopes(owner, name, assemblies = defaultAssemblies) {
  const length = Array.isArray(assemblies) ? assemblies.length : 0;
  if (length < 1 || length > approvedAssemblies.size) return failure(owner, name, 'a bounded assembly list is required');
  const scopes = [];
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(assemblies, String(index));
    if (!item || !Object.hasOwn(item, 'value') || !approvedAssemblies.has(item.value)) {
      return failure(owner, name, 'assembly scopes must contain approved names as plain data');
    }
    scopes.push(item.value);
  }
  if (!scopes.includes('System.Runtime') || new Set(scopes).size !== length) {
    return failure(owner, name, 'System.Runtime is required; only one optional System.Private.CoreLib scope is supported');
  }
  return Object.freeze(scopes);
}

/** Copy a closed, JSON-safe field profile. Values are immutable and are not C# constants or method contracts. */
export function normalizeReadonlyFields(owner, fields) {
  fields = dataRecord(fields);
  if (!fields || Object.keys(fields).length > 256) failure(owner, '<fields>', 'a bounded field map of plain data is required');
  const normalized = Object.create(null);
  for (const [name, input] of Object.entries(fields)) {
    const descriptor = dataRecord(input);
    if (!name || name.length > 512 || name.includes('\0') || !descriptor ||
        Object.keys(descriptor).some(key => !descriptorKeys.has(key))) failure(owner, name, 'malformed descriptor');
    if (descriptor.isStatic !== true || descriptor.readOnly !== true ||
        descriptor.addressable !== undefined && typeof descriptor.addressable !== 'boolean') {
      failure(owner, name, 'only static readonly fields with an explicit address policy are supported');
    }
    normalized[name] = Object.freeze({
      type: descriptor.type,
      isStatic: true,
      readOnly: true,
      value: scalarValue(owner, name, descriptor.type, descriptor.value),
      addressable: descriptor.addressable ?? false,
      assemblies: assemblyScopes(owner, name, descriptor.assemblies)
    });
  }
  return Object.freeze(normalized);
}

/** Validate replacement maps at registration commit; a failing contribution is rolled back by the registry. */
export function normalizeRegistryFields(types) {
  for (const type of types.values()) {
    if (type.fields !== undefined) type.fields = normalizeReadonlyFields(type.name, type.fields);
  }
}
