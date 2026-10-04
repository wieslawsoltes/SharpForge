# @sharpforge/language

Reusable diagnostics, completion, navigation, rename, symbols and classification.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/language';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

## Editor provider additions

`LanguageService.inlayHints(uri, {start = 0, end = source.length} = {})` returns
inferred type hints for bound local declarations written with `var`. The optional
range uses UTF-16 offsets. Results use LSP positions and labels, do not change the
source, and exclude unresolved types. Invalid ranges throw `RangeError`.
The LSP adapter and Studio compiler worker share this implementation.
Parameter-name hints and test-status CodeLens values remain optional provider extensions.

`signatureHelp(uri, offset)` continues to resolve signatures through the current
compilation's method symbols. It accepts Unicode method names and whitespace
before the opening parenthesis. The editor tracks delimiter nesting and supplies
the active invocation's opening offset to Studio, so the provider can resolve
an outer call after an inner call has completed. Overload resolution remains
limited to the language service's supported symbol model.
