# Assembly definition identity

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
