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
This batch adds explicit assembly definition options only. AssemblyVersion/AssemblyCulture
source attributes, referenced assembly identities and net9/net10 reference-pack versions
remain separate work under SF-A03-T03.8. Signing is independent of version/culture.

Native `AssemblyName.GetAssemblyName` reference generation and focused tests are prepared
under `tests/fixtures/a03-assembly-definition`; validation is pending its serial slot.
