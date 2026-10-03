# @sharpforge/symbols

Portable PDB read/write, embedded symbols, source validation and PE binding. Pure ES modules; depends on @sharpforge/cil. Main exports include readPortablePdb, emitPortablePdb, loadSymbols, attachPortablePdb, bindSources, readDebugDirectory, sourceLinkUrl and SHA/DEFLATE helpers.

```js
import {loadSymbols,bindSources} from '@sharpforge/symbols';
const symbols=loadSymbols(assemblyBytes,pdbBytes);
const binding=bindSources(symbols,{'/src/Program.cs':sourceBytes});
// Only checksum-verified source enters binding.sources.
```

All eight debug tables are parsed; unknown CDI retains raw bytes. PE CodeView/embedded identity and SHA256 checksum are checked. SHA1/SHA256 automatic source binding; SHA384/512 through verifySourceAsync. Source Link does not implicitly access the network. Writer interoperability with native Visual Studio/CLR has not been qualified. See the source distribution's docs/advanced-debugging-winui.md and tests/portable-pdb.test.js for contracts, limits and provenance.

Implementation is separated into sequence point codecs, metadata reader and builder, PDB writer, PE debug directory, identity binding and source binding modules. The package entry point remains the public contract; consumers do not import these internal modules directly.

`emitPortablePdb(assembly, debug)` accepts `debug.importScopes` in row order;
`parent` is zero or an earlier one-based scope id. Each scope has `definitions`
using Portable PDB import kinds 1–9 (`alias`, `namespace`, AssemblyRef row id
`assembly`, and metadata token `type`, as applicable). A debug method may supply
`importScope` and `constants`, or explicit `scopes` containing IL-byte `start`
and exclusive `end`, `locals`, `constants` and `importScope`. The root scope spans
the method body; child scopes must be nested or disjoint. Existing compiler PC
scopes remain accepted. Constants accept primitive `type`/`value` pairs, optional
`enumType` metadata tokens, or a compiler-provided `signature` Uint8Array. Use
BigInt for 64-bit integers. Invalid names, ranges, imports and references throw
`SymbolError`.

Source documents accept `hashAlgorithm` and `language` GUIDs and a `hash`
Uint8Array. SHA-1 and SHA-256 are computed synchronously when omitted;
SHA-384/SHA-512 need the compiler's precomputed digest. Hash inputs are exact source
bytes, including BOMs and line endings. Document path components are deduplicated
using System.Reflection.Metadata's separator selection. Portable PDB has a
language column and no vendor column. References: the
[Portable PDB v1.0 specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md)
and [SRM document-name encoder](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Ecma335/MetadataBuilder.Heaps.cs).

The new import/constant/document writer batch has not yet been validated with
System.Reflection.Metadata. The independent native readback gate remains work
for SF-A13-T01.8; it must pass before interoperability is claimed.

Known Windows PDB MSF 7.00/2.00 and legacy CodeView NB09/NB10/NB11 inputs fail
with `SymbolError.code === 'SF_SYMBOL_UNSUPPORTED_FORMAT'` and a descriptive
`format`. They are not parsed as corrupt Portable PDB metadata.

`readCustomDebugInformation(kind, bytes, limits)` and
`writeCustomDebugInformation(kind, record)` expose bounded CDI codecs. EnC slot
maps use `slots` (`kind: null` for a temporary); lambda maps expose
`methodOrdinal`, `closures` and `lambdas`; state maps expose `states` with signed
`stateNumber`, `syntaxOffset` and `relativeOrdinal`. The optional
`syntaxOffsetBaseline` preserves Roslyn's encoded baseline. Unknown CDI kinds
retain `bytes`. A supplied `bytes` property requests exact raw preservation.
`debug.custom` accepts records with `parent` metadata tokens and `kind` GUIDs;
`debug.stateMachines` accepts `moveNext`/`kickoff` MethodDef token pairs.

Compilation CDI codecs expose dynamic `flags` (LSB first, trailing zero bytes
omitted), tuple `names` (null for unnamed elements), default `namespace`,
compilation `options`, metadata `references` (including MVID, aliases, flags,
timestamp and image size), type `documents` and the empty `primaryConstructor`
marker. Strings are strict UTF-8; terminated fields, duplicate option names,
counts and payload sizes are checked. EnC wire details follow Roslyn's
`EditAndContinueMethodDebugInformation`; primary-constructor markers follow its
`MetadataWriter.PortablePdb` emitter. Native fixture qualification is separate
from synthetic codec round trips.

Embedded sources of at least 200 bytes use the archive package's bounded
fixed-Huffman DEFLATE encoder when smaller; short/incompressible sources retain
raw representation. Embedded Portable PDB entries use the same encoder. This is
real compression, independent of platform CompressionStream availability.
