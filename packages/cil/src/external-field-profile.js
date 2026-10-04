import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {decodeCoded} from './metadata/indices.js';
import {sha1} from './binary/sha1.js';
import {decodeSignature} from './metadata/signatures.js';

const publicKeyTokens = new Map([
  ['System.Runtime', 'b03f5f7f11d50a3a'],
  ['System.Private.CoreLib', '7cec85d7bea7798e']
]);
const instanceAccess = new Set(['ldfld', 'stfld', 'ldflda']);

function assemblyScope(metadata, ownerToken, owner) {
  const row = metadata.row(ownerToken);
  const scope = decodeCoded('ResolutionScope', row[0]);
  if (scope >>> 24 !== 35) return null;
  const separator = owner.lastIndexOf('.');
  const namespace = separator < 0 ? '' : owner.slice(0, separator);
  if (metadata.string(row[1]) !== owner.slice(separator + 1) || metadata.string(row[2]) !== namespace) {
    throw new CilError('External readonly field has an incompatible declaring type identity');
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

/** Admit only registered exact field signatures through approved framework AssemblyRef identities. */
export function resolveExternalReadonlyField(inspector, member) {
  if (member.token >>> 24 !== 10 || member.resolvedToken || member.ownerToken >>> 24 !== 1) return null;
  const entry = frameworkType(member.owner);
  if (entry?.name !== member.owner || !entry.fields || !Object.hasOwn(entry.fields, member.name)) return null;
  const descriptor = entry.fields[member.name];
  const metadata = inspector.metadata;
  const scope = assemblyScope(metadata, member.ownerToken, member.owner);
  // TypeRefs scoped to this module still belong to ordinary internal field resolution.
  if (!scope) return null;
  const assembly = metadata.string(scope[6]);
  // Facade version compatibility is intentional: preserve the version without using it as an admission key.
  if (!descriptor.assemblies.includes(assembly) || metadata.string(scope[7]) !== '' ||
      publicKeyToken(metadata, scope) !== publicKeyTokens.get(assembly)) {
    throw new CilError('External readonly field has an unapproved assembly identity');
  }
  const signature = decodeSignature(metadata.blob(metadata.row(member.token)[2]));
  if (signature.kind !== 'field' || signature.type.kind !== 'primitive' || signature.type.name !== descriptor.type ||
      member.signature.type !== descriptor.type) {
    throw new CilError('External readonly field has an incompatible signature');
  }
  return {
    ...member,
    isStatic: true,
    isInitOnly: true,
    resolvedToken: member.token,
    ownerInstance: null,
    genericArguments: [],
    volatile: false,
    externalField: descriptor
  };
}

/** A profile access failure, or null. Shared by admission and runtime defenses; internal fields are unchanged. */
export function executionFieldAccessError(field, opcode) {
  if (!field.externalField && !field.decimalConstant) return null;
  if (instanceAccess.has(opcode)) return 'External readonly fields require static access';
  if (opcode === 'stsfld') return field.decimalConstant ? 'Decimal constants are readonly' : 'External fields are readonly';
  if (opcode === 'ldsflda' && field.externalField?.addressable === false) {
    return 'External readonly field does not permit managed addresses';
  }
  return null;
}
