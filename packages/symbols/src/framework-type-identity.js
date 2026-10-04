import { decodeCoded } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';
import { hex, sha1 } from './hash.js';

const frameworkTokens = Object.freeze({
  'System.Runtime': 'b03f5f7f11d50a3a',
  'System.Private.CoreLib': '7cec85d7bea7798e',
  mscorlib: 'b77a5c561934e089',
});

function frameworkAssembly(metadata, scope, state) {
  if (state.assemblies.has(scope)) return state.assemblies.get(scope);
  if (state.assemblies.size >= 1024) fail('Constant assembly identity limit exceeded');
  const definition = scope >>> 24 === 32;
  const row = metadata.row(scope);
  const shift = definition ? 1 : 0;
  const name = metadataName(metadata, row[6 + shift], 'Constant assembly');
  const expected = Object.hasOwn(frameworkTokens, name) ? frameworkTokens[name] : null;
  let matched = false;
  if (expected && metadataName(metadata, row[7 + shift], 'Constant assembly culture') === '') {
    const flags = row[4 + shift];
    const key = metadata.blob(row[5 + shift]);
    if (key.length > 16384 || (state.keyBytes += key.length) > 1024 * 1024) {
      fail('Constant assembly key byte limit exceeded');
    }
    const fullKey = !!(flags & 1);
    if (!(flags & ~0x101) && (fullKey ? key.length >= 16 : !definition && key.length === 8)) {
      const token = fullKey ? sha1(key).subarray(12).reverse() : key;
      matched = hex(token) === expected;
    }
  }
  state.assemblies.set(scope, matched);
  return matched;
}

function namedType(metadata, token, state, accepts) {
  const table = token >>> 24;
  if (table !== 1 && table !== 2) return null;
  const row = metadata.row(token);
  if (table === 1 ? (row[0] & 3) === 3 : (row[0] & 7) > 1) return null;
  const name = metadataName(metadata, row[1], 'Constant type');
  if (!accepts(name) || metadataName(metadata, row[2], 'Constant namespace') !== 'System') return null;
  let scope = table === 1 ? decodeCoded('ResolutionScope', row[0]) : 0x20000001;
  if (scope === 1) scope = 0x20000001;
  if (scope >>> 24 !== 35 && scope !== 0x20000001) return null;
  if (scope === 0x20000001 && metadata.rows[32]?.length !== 1) return null;
  return frameworkAssembly(metadata, scope, state) ? name : null;
}

/** Resolve only declared top-level framework identities; does not load assemblies or verify signatures. */
export function createFrameworkTypeResolver(metadata, accepts, maxTypes = 4096) {
  const state = { assemblies: new Map(), keyBytes: 0 };
  const types = new Map();
  return (token) => {
    if (!types.has(token)) {
      if (types.size >= maxTypes) fail('Framework type identity limit exceeded');
      types.set(token, namedType(metadata, token, state, accepts));
    }
    return types.get(token);
  };
}
