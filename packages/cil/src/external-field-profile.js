import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {decodeSignature} from './metadata/signatures.js';
import {frameworkAssemblyScope, approvedFrameworkAssembly} from './metadata/framework-type-identity.js';

const instanceAccess = new Set(['ldfld', 'stfld', 'ldflda']);

/** Admit only registered exact field signatures through approved framework AssemblyRef identities. */
export function resolveExternalReadonlyField(inspector, member) {
  if (member.token >>> 24 !== 10 || member.resolvedToken || member.ownerToken >>> 24 !== 1) return null;
  const entry = frameworkType(member.owner);
  if (entry?.name !== member.owner || !entry.fields || !Object.hasOwn(entry.fields, member.name)) return null;
  const descriptor = entry.fields[member.name];
  const metadata = inspector.metadata;
  const scope = frameworkAssemblyScope(metadata, member.ownerToken, member.owner, 'External readonly field');
  // TypeRefs scoped to this module still belong to ordinary internal field resolution.
  if (!scope) return null;
  // Facade version compatibility is intentional: preserve the version without using it as an admission key.
  if (!approvedFrameworkAssembly(metadata, scope, descriptor.assemblies)) {
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
