import { assemblyReferenceIdentity } from '@sharpforge/cil';
import { AssemblyIdentity } from '../../metadata-import/assembly-identity.js';

/** Qualify the primitive typeof argument through the same identity that the emitted framework TypeRef uses. */
export function fixedBufferTypeName(types, elementType, fullName) {
  const assembly = types.assemblyOf(elementType.originalDefinition ?? elementType, fullName)
    ?? (types.builder.framework === 'mscorlib4' ? 'mscorlib' : 'System.Runtime');
  const identity = assemblyReferenceIdentity(types.builder, assembly);
  const display = new AssemblyIdentity({ name: identity.name, version: identity.version, cultureName: identity.culture,
    ...(identity.flags & 1 ? { publicKey: identity.publicKeyOrToken } : { publicKeyToken: identity.publicKeyOrToken }),
    isRetargetable: !!(identity.flags & 0x100), contentType: identity.flags & 0x200 ? 'windowsRuntime' : 'default' }).getDisplayName();
  return fullName + ', ' + display;
}
