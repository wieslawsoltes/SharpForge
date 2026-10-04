# Explorer disk lifecycle

`ExplorerDiskServices(view)` composes the provider search index, coalescer and reload
coordinator with `DiskServicesView`. Construct it once, call `observe(data)` after
accepted workspace changes, and call `dispose` when the Explorer closes. The view
supplies `element`, `tree`, `search`, `getData`, `onCommand`, `onOpen`, and optional
`onError`. Data supplies the additive `ProviderDiskWorkspace` as `disk`, optional
`provider`, `records` (or `files`), `revision`, `dirty`, `tabs`, `active`, `native`,
and `fileBusy`. The library does not acquire a physical identity or save lock.

Commands preserve the existing Explorer callback shape:
`onCommand(action, {path}, [], payload)`. `disk-external-change` receives the decoded
record, watch event and expected editor version; `disk-reevaluate` receives either
a project record/event or a coherent metadata `records`/`folders`/`report` scan.
The host validates membership/revision, overlays dirty buffers, and adopts accepted
physical state. Returning `{reevaluated:true}` from an atomic project-file update
prevents a duplicate evaluation. A missing document version is zero.

Open clean documents reload, dirty documents show keep/compare/reload choices, and
closed non-project files remain explicit lazy metadata. Workspace identity and local
revision checks guard delayed scans and file status results. Watch events wait while
`fileBusy`; exact saved-byte hashes suppress only the completed own write.

The controller temporarily installs `disk.findInFiles(query, options)` with the
LanguageService result shape. It searches current editor overlays, streams closed
file contents without opening editors, and combines caller cancellation with the
workspace lifetime. Path searches show at most 100 buttons. Closing restores a
pre-existing search callback and disposes late watcher subscriptions.

Node composition tests use an explicit DOM adapter and in-memory provider with
controlled asynchronous status/watch/read gates. Real browser layout/native picker
qualification remains separate. The protected Studio entry and final Explorer host
wiring are owned by the application integration batch.
