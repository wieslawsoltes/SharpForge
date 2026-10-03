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
