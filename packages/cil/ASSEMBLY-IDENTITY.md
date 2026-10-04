# Assembly definition identity

## Shared identity values

`@sharpforge/cil` exports `AssemblyIdentity`, `AssemblyIdentityParts`, `IdentityComparison`,
`compareAssemblyIdentity`, `referenceMatchesDefinition`, `compareVersions`, `publicKeyToken`
and `sha1`. The compiler's existing identity module re-exports this same implementation, so
metadata binding and a closed project assembly loader use the same immutable identity type.

`new AssemblyIdentity({ name, version, cultureName, publicKey, publicKeyToken, isRetargetable,
contentType })` accepts dotted versions or component arrays and hexadecimal keys or bytes.
Unsigned assemblies keep `publicKeyToken: ''`; invariant culture is `cultureName: ''`.
`getDisplayName()` renders those as `PublicKeyToken=null` and `Culture=neutral`, escapes the
simple name, and includes retargetable and Windows Runtime flags when present. Full identity
`equals` compares simple names and cultures without case, and all remaining components exactly.
`tryParse` returns `{ identity, parts }` or `null`; `parse` throws `RangeError` for invalid input.

Binding comparison is intentionally distinct from full identity equality: weak definitions can
bind across versions, while strong definitions require matching tokens and versions unless an
explicit unification policy is passed. Project artifact hash admission uses full identity equality.
`publicKeyToken` computes the ECMA token from a full key; `sha1` is supplied for compatibility
with existing metadata consumers, not for artifact integrity checks (which use SHA-256).

## Emitted definition identities

`compileToIL(source, { assemblyVersion: '1.2.3.4', assemblyCulture: 'en-US' })` writes
those values into the Assembly definition row. `MetadataBuilder(name, options)` accepts
the same options. Version values are either four decimal components or an array of four
integers from 0 through 65535. Arrays are copied; wildcard/time-based versions are rejected.

Culture is an empty string for invariant identity, `neutral` (normalized to empty), or an
ASCII culture tag such as `en-US`/`ja-JP`, at most 85 characters. This checks tag syntax,
not the host's culture registry. Invalid values produce `CilError`, surfaced as SF3001 by
the compiler. Defaults retain the existing version `0.2.0.0` and invariant culture.

Canonical source replay reads identity from actual metadata instead of an embedded copy.
Explicit definition and reference options are supported here. AssemblyVersion/AssemblyCulture
source attributes remain separate work under SF-A03-T03.8. Signing is independent of version/culture.

Native `AssemblyName.GetAssemblyName` on .NET 10.0.5 confirms all five fixture identities
under `tests/fixtures/a03-assembly-definition`. Focused tests pass for both JavaScript engines
and all four emitted platforms, including composition with signing and resources. Browser
and wider platform qualification remain separate.

## Input reference identities

High-level emission accepts `referenceAssemblies: [Uint8Array, ...]` with full PE assembly
bytes. It reads their Assembly definitions once at the emission boundary, then uses their
real name/version/culture/full public key for requested AssemblyRefs. Full keys are marked
with the ECMA PublicKey flag; token computation/verification is left to consuming runtimes.
Inputs are bounded to 1024 assemblies and 64 MiB total. This controls emitted identities;
it does not add external-type binding or methods to the compiler's supported CIL profile.

Both emission and `MetadataBuilder` also accept `assemblyReferences` identity records:
`{ name, version, culture, flags, publicKeyOrToken }`, where version is explicit, flags
support PublicKey/Retargetable/WindowsRuntime, and key bytes are copied. Duplicate names
(case-insensitive), malformed keys/tokens and unknown flags are rejected. Full cryptographic
key validation is not performed by the metadata writer.

Existing `net8`/`mscorlib4` fallback identities are unchanged. New `net9` and `net10` profiles
require supplied identity data for each referenced framework assembly; missing input fails
explicitly. Canonical replay reconstructs those records from actual AssemblyRef metadata.
Native `Assembly.GetReferencedAssemblies` on .NET 10.0.5 confirms versions 9.0.0.0 and
10.0.0.0 and token b03f5f7f11d50a3a from the real net9/net10 reference packs. The six
focused tests cover both JavaScript engines, malformed inputs and legacy defaults.

The full-key flag follows the [AssemblyFlags.PublicKey contract](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.assemblyflags).

## Friend assembly access

`grantsInternalsAccess(declarations, identity)` is the shared compiler and CIL graph rule for
`InternalsVisibleTo` string declarations. It returns a boolean. Names compare without case, while a
declaration containing `PublicKey=` requires the target identity's matching full public key. Quoted and
escaped names use the same tokenizer as `AssemblyIdentity.tryParse`. A public
key token cannot satisfy that declaration. Version, culture, token, duplicate-key, malformed-key and
control-character forms do not grant access. Invalid input fails closed. The list is limited to 4096
declarations and each declaration to 16384 UTF-16 code units.
