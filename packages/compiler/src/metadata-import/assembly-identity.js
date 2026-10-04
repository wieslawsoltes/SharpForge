// Keep existing compiler consumers on the identity implementation shared with CIL and the runtime.
export {
  AssemblyIdentity, AssemblyIdentityParts, IdentityComparison, compareAssemblyIdentity,
  referenceMatchesDefinition, compareVersions, publicKeyToken, sha1,
} from '@sharpforge/cil';
