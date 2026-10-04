const aliases = Object.freeze({ Void: 'void', Boolean: 'bool', Char: 'char', SByte: 'sbyte', Byte: 'byte',
  Int16: 'short', UInt16: 'ushort', Int32: 'int', UInt32: 'uint', Int64: 'long', UInt64: 'ulong',
  Single: 'float', Double: 'double', String: 'string', Object: 'object', IntPtr: 'nint', UIntPtr: 'nuint' });

export function normalizeType(value) {
  return String(value).replace(/System\.([A-Za-z][A-Za-z0-9]*)/g, (match, name) => aliases[name] ?? match).replace(/,\s+/g, ',');
}

export function splitParameters(value) {
  if (!value) return [];
  const result = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if ('<(['.includes(value[index])) depth++;
    if ('>)]'.includes(value[index])) depth--;
    if (depth < 0) throw new Error('Unbalanced metadata signature');
    if (value[index] === ',' && depth === 0) { result.push(value.slice(start, index).trim()); start = index + 1; }
  }
  if (depth) throw new Error('Unbalanced metadata signature');
  result.push(value.slice(start).trim());
  return result;
}

/** Parse the checked-in canonical metadata form without deleting or inventing reference rows. */
export function parseReferenceRow(row) {
  if (!row || typeof row.signature !== 'string' || typeof row.owner !== 'string') throw new TypeError('Malformed reference member');
  if (row.kind === 'type') return { ...row, parameters: [], result: row.owner, isStatic: false };
  if (Array.isArray(row.parameters) && typeof row.result === 'string') return row;
  const prefix = row.owner + '::';
  if (!row.signature.startsWith(prefix)) throw new Error('Reference owner does not match its signature: ' + row.key);
  const signature = row.signature.slice(prefix.length);
  let match;
  if (row.kind === 'method') {
    match = /^(.+)``(\d+)\((.*)\):(.+) (static|instance)$/.exec(signature);
    if (match) return { ...row, name: match[1], genericArity: Number(match[2]), parameters: splitParameters(match[3]),
      result: match[4], isStatic: match[5] === 'static' };
  } else if (row.kind === 'property') {
    match = /^(.+)\[(.*)\]:(.+?) (get(?: set)?|set) (static|instance)$/.exec(signature);
    if (match) return { ...row, name: match[1], parameters: splitParameters(match[2]), result: match[3],
      get: match[4].includes('get'), set: match[4].includes('set'), isStatic: match[5] === 'static' };
  } else if (row.kind === 'event' || row.kind === 'field') {
    match = /^(.+):(.+) (static|instance)$/.exec(signature);
    if (match) return { ...row, name: match[1], parameters: [], result: match[2], isStatic: match[3] === 'static' };
  }
  throw new Error('Unrecognized metadata signature: ' + row.signature);
}

export function methodKey(member, { projected = false } = {}) {
  const name = projected && member.name.startsWith('set_') ? 'put_' + member.name.slice(4) : member.name;
  return [normalizeType(member.owner), name, member.isStatic ? 'static' : 'instance', member.genericArity ?? 0,
    member.parameters.map(normalizeType).join(','), normalizeType(name === '.ctor' ? 'void' : member.result)].join('|');
}

export const isWinUIType = name => /^(Microsoft\.UI\.|Windows\.UI\.)/.test(name);

export function signatureText(member) {
  return `${member.owner}::${member.name}(${member.parameters.join(',')}):${member.result} ${member.isStatic ? 'static' : 'instance'}`;
}
