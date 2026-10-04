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

## Metadata-backed language services

When a workspace supplies `compilationOptions.references`, each `LanguageService` owns a cached compiler metadata query session.
Completion and hover expose accessible imported members, and diagnostics use semantic binding independently of executable lowering.
Imported definitions have no editable source location. Replacing reference bytes, identities or aliases discards the decoded session;
source revisions and compilation-option changes invalidate source binding while retaining unchanged assemblies. Removing references
clears the session. Native callers supply the selected context's generated and user documents, options and exact reference bytes before
querying the service. Existing source/framework completions and semantic rename continue through their established delegates.
