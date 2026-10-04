# DateTime local constants

Explicit generation (one native VB build and one SRM reader invocation):

```sh
DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-datetime-constants.mjs \
  --capture tests/fixtures/portable-pdb-datetime-constants
```

`packages/symbols/interop/DateTimeConstants` contains four VB Date literals and
the native `BlobReader.ReadDateTime` oracle. `reference.json` records the exact
SDK/compiler/runtime and source/PE/PDB hashes, ticks, unspecified kind and original
constant signatures. It also records DateTime constructor tick limits and two
out-of-range rejections; SRM delegates to that constructor.

The Portable PDB format encodes DateTime as an eight-byte signed tick count:
[LocalConstantSig specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md#localconstantsig-blob).
The native reader uses
[BlobReader.ReadDateTime](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/BlobReader.cs).

Offline tests read the retained files and do not build or rewrite them. This
fixture qualifies this VB/native reference only; no broader compiler/platform
matrix, DateTimeOffset, time-zone conversion or type resolver is claimed.
