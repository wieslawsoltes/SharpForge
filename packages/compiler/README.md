# @sharpforge/compiler

Cross-file binding and supported semantic checks with managed bytecode emission.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/compiler';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

Registered types may specify `defaultMember: 'Chars'` (a nonempty string) to select
their indexed property. Closed and open generic symbol binding and the legacy
compiler resolve the corresponding existing `get_Chars` / `set_Chars` contracts;
no alias methods or contract IDs are created. An absent marker inherits a
registered base's marker, then falls back to the released `Item` convention.
The metadata name rule is defined once in `src/symbols/registry-indexers.js`.
Built-in string element lowering remains separate, including its read-only char
behavior. This seam supports the registry's existing accessor shapes; it does not
add multi-argument indexer execution or reflection attribute import.

`tests/compiler-lowering-registered-indexer.test.js` covers named metadata through
semantic binding and the extracted legacy preparation/load/store seam, plus
existing Item and string execution through both pipelines on source/CIL VMs.
Real StringBuilder `Chars` execution is qualified by its dependent BCL feature.
`scripts/benchmarks/a07-registered-indexer-compile.mjs` measures identical existing
Item/string sources on parent `1ddab235` and candidate, with one warmup and five
samples for each compiler pipeline. It performs no VM execution; host heap deltas
are reported separately from elapsed time and are not allocation counts.
