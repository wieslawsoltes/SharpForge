const primitiveAliases = Object.freeze({
  'System.Object': 'object', 'System.String': 'string', 'System.Boolean': 'bool', 'System.Char': 'char',
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong',
  'System.Single': 'float', 'System.Double': 'double', 'System.Decimal': 'decimal',
  'System.IntPtr': 'nint', 'System.UIntPtr': 'nuint'
});

function splitArguments(text) {
  const result = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '<' || character === '[') { if (++depth > 64) return null; }
    if (character === '>' || character === ']') { if (--depth < 0) return null; }
    if (character === ',' && !depth) { result.push(text.slice(start, index).trim()); start = index + 1; }
  }
  if (depth || result.length >= 32) return null;
  result.push(text.slice(start).trim());
  return result.every(Boolean) ? result : null;
}

function normalizedType(name, aliases, depth = 0) {
  if (depth > 64 || typeof name !== 'string' || name.length > 16384) return null;
  name = name.trim();
  if (name.endsWith('[]')) {
    const element = normalizedType(name.slice(0, -2), aliases, depth + 1);
    return element && element + '[]';
  }
  const angle = name.indexOf('<');
  if (angle < 0) return primitiveAliases[name] ?? aliases.get(name) ?? name;
  if (!name.endsWith('>')) return null;
  const argumentsList = splitArguments(name.slice(angle + 1, -1));
  if (!argumentsList) return null;
  const arguments_ = argumentsList.map(argument => normalizedType(argument, aliases, depth + 1));
  if (arguments_.some(argument => !argument)) return null;
  let owner = name.slice(0, angle).trim();
  const arity = /`(\d+)$/.exec(owner);
  if (arity && Number(arity[1]) !== arguments_.length) return null;
  if (!arity) owner += '`' + arguments_.length;
  const key = owner + '<' + arguments_.join(', ') + '>';
  return aliases.get(key) ?? key;
}

/** Register alternate CLI argument spellings only for concrete types already in this registry. */
export function registerGenericAliases(name, aliases) {
  const angle = name.indexOf('<');
  if (angle < 0) return;
  const normalized = normalizedType(name, aliases);
  if (!normalized) return;
  const owner = normalized.slice(0, normalized.indexOf('<'));
  const short = owner.slice(owner.lastIndexOf('.') + 1) + normalized.slice(normalized.indexOf('<'));
  for (const key of [normalized, short]) if (!aliases.has(key)) aliases.set(key, name);
}

export function resolveRegisteredGenericAlias(name, aliases) {
  if (!name.includes('<')) return null;
  const normalized = normalizedType(name, aliases);
  return normalized ? aliases.get(normalized) ?? null : null;
}
