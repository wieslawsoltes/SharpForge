# Versioned Workspace document admission

`Workspace` keeps a monotonic version watermark for every URI. Removal releases
SourceText and syntax, but does not reset that watermark. Import validates the
complete snapshot, rejects duplicate or oversized documents before mutation, and
assigns a version higher than both imported and previously observed versions.
An edit prepared before import or close/reopen cannot replace the newer document.

The former default count of 100 documents is replaced by a 64 MiB loaded UTF-16
text budget. `maxDocuments` remains an explicit caller option; `maxDocumentLength`
retains the per-document source limit. Invalid versions and exhausted safe-integer
version space reject explicitly. `loadedDocumentBytes` records the retained text
budget, independently of the provider cache's exact byte-array storage.

`new Workspace({documentStore})` composes the bounded `LazyDocumentStore` from the
prerequisite batch. `registerFile(record)` accepts metadata without creating any
SourceText. `openFile(uri, options)` reads one provider record and admits text while
leaving syntax unparsed until requested. `closeFile(uri, {discard})` unpins and
unloads clean records; dirty records remain unless discard was explicitly requested.
Store eviction releases the corresponding SourceText and syntax through a subscribed
callback. `dispose()` releases Workspace caches and that subscription; the caller
continues to own and dispose the store itself.

`compileAsync({signal, ...options})` materializes registered C# compilation inputs
whose `compile` flag is not false. A compilation larger than its configured budgets
fails admission explicitly. Compilation is not streamed or claimed to be unbounded.
Synchronous `compile()` and option-aware syntax/extension behavior retain their
existing implementation.

The focused lifecycle fixture registers 5,000 files with zero reads or SourceText,
opens/parses/closes one, compiles only a selected input and verifies a higher reopen
version. Actual editor widgets, worker caches and physical disk release are handled
by the dependent Studio lifecycle batch.
