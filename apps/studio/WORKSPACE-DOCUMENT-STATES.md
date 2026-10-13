# Document state capture

`workspaceDocumentStates(documents)` captures a `Map` from each document URI to
its current immutable `DocumentService.captureState(uri)` result. Each value
retains the exact source, saved baseline, version, dirty flag and stale-save
flag. The capture contains no model or editor subscription and never reads the
compatibility text getter. An absent document service returns `undefined` so
older plain-host callers retain their established behavior.

This helper does not adopt documents, change dirty state, dispose models, or
persist data. A receiving history/recovery layer validates the captured roots;
`Documents.replace(..., {documentStates})` remains the ownership boundary.

```js
import {workspaceDocumentStates} from './workspace-source-records.js';
const documentStates = workspaceDocumentStates(documents);
```

The helper is the exact standalone function from canonical Project 18 source
`bb2b8d84c8dfc0b14fc76b2c605b84d48a1e993e`. The workspace file-record capture API
is a separate dependent addition to this module after its prepared-Explorer
prerequisite is published; no placeholder export is installed here.

Integrated qualification is recorded against that canonical source and the
unchanged `a24-studio-session-composition` cases. This small foundation does not
claim native controller, provider, save, or recovery application composition.
