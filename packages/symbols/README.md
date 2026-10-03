# @sharpforge/symbols

Portable PDB read/write, embedded symbols, source validation and PE binding. Pure ES modules; depends on @sharpforge/cil. Main exports include readPortablePdb, emitPortablePdb, loadSymbols, attachPortablePdb, bindSources, readDebugDirectory, sourceLinkUrl and SHA/DEFLATE helpers.

```js
import {loadSymbols,bindSources} from '@sharpforge/symbols';
const symbols=loadSymbols(assemblyBytes,pdbBytes);
const binding=bindSources(symbols,{'/src/Program.cs':sourceBytes});
// Only checksum-verified source enters binding.sources.
```

All eight debug tables are parsed; unknown CDI retains raw bytes. PE CodeView/embedded identity and SHA256 checksum are checked. SHA1/SHA256 automatic source binding; SHA384/512 through verifySourceAsync. Source Link does not implicitly access the network. Writer interoperability with native Visual Studio/CLR has not been qualified. See the source distribution's docs/advanced-debugging-winui.md and tests/portable-pdb.test.js for contracts, limits and provenance.
