# Nullable default constants

This fixture is built explicitly with SRM MetadataBuilder and PortablePdbBuilder.
It is not output from C# nullable const declarations. Sixteen closed Nullable<T>
TypeSpecs cover scalar value-type primitives, Decimal and DateTime; each constant
has no value payload. SRM decodes the actual TypeSpec/signature, while CoreCLR
`Activator.CreateInstance` independently observes the boxed default as null.

```sh
DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-nullable-constants.mjs \
  --capture tests/fixtures/portable-pdb-nullable-constants
```

The reference records SDK/compiler/runtime, generator source hashes, PE/PDB
hashes, exact blobs and CLR observations. Offline tests do not regenerate files.
The [Portable PDB GeneralConstant format](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md#localconstantsig-blob)
defines absent payload as the type's default value. Open generics, custom struct
arguments, arbitrary present payloads, and broader platform qualification remain
outside this fixture.
