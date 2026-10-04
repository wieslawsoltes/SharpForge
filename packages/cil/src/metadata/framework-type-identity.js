import {CilError} from '../binary.js';
import {sha1} from '../binary/sha1.js';
import {decodeCoded} from './indices.js';

const publicKeyTokens = new Map([
  ['System.Runtime', 'b03f5f7f11d50a3a'],
  ['System.Private.CoreLib', '7cec85d7bea7798e'],
  ['mscorlib', 'b77a5c561934e089']
]);

/** Match a top-level TypeRef's raw name and namespace before exposing its AssemblyRef. */
export function frameworkAssemblyScope(metadata, ownerToken, owner, subject) {
  if (ownerToken >>> 24 !== 1) return null;
  const row = metadata.row(ownerToken);
  const scope = decodeCoded('ResolutionScope', row[0]);
  if (scope >>> 24 !== 35) return null;
  const separator = owner.lastIndexOf('.');
  const namespace = separator < 0 ? '' : owner.slice(0, separator);
  if (metadata.string(row[1]) !== owner.slice(separator + 1) || metadata.string(row[2]) !== namespace) {
    throw new CilError(subject + ' has an incompatible declaring type identity');
  }
  return metadata.row(scope);
}

function publicKeyToken(metadata, row) {
  const bytes = metadata.blob(row[5]);
  if (bytes.length > 16384 || (row[4] & ~1) !== 0) return null;
  if (row[4] & 1) {
    if (bytes.length < 16) return null;
    return [...sha1(bytes).slice(-8)].reverse().map(value => value.toString(16).padStart(2, '0')).join('');
  }
  return bytes.length === 8 ? [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') : null;
}

/** Each caller retains its admitted facade names; versions do not alter the approved key and neutral-culture policy. */
export function approvedFrameworkAssembly(metadata, scope, assemblies) {
  const assembly = metadata.string(scope[6]);
  return assemblies.includes(assembly) && metadata.string(scope[7]) === '' &&
    publicKeyToken(metadata, scope) === publicKeyTokens.get(assembly);
}
