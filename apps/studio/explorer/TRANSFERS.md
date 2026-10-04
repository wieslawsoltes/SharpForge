# Explorer transfer contributions

`registerClipboardCommands(registry)` contributes copy/cut/paste and explicit copy-to/move-to handlers.
The composition host provides current workspace identity, physical selection, `move`, `notice`, and the
solution-item contribution. Copy naming compares portable Unicode/case identities while preserving
original path spelling and extensions. Paste refuses a clipboard from another workspace. A cut is
cleared only after the movement reports a nonempty completed set.

`inspectMoveBatch(context, mappings, options)` validates every requested source and destination before
any effect. Missing paths, overlaps, invalid paths, collisions, read-only state and unsafe project-folder
relocations remain visible as rejected entries. `confirmMoveBatch` returns the valid subset only after
a separate partial-completion confirmation. The dependent mutation engine performs journal/provider
preflight again before any physical mutation.

`ExplorerDragDrop({element, model, treeId, onCommand, onError})` registers capture-phase listeners for
OS-file and modifier-link drops. Ordinary tree moves continue through the shared tree control. Link
payloads are bounded and resolve identifiers against the current model from the same explorer. Files
retain their original byte-reading handles and are dispatched to `import-drop`; empty directory drops
have an explicit unsupported diagnostic. Non-container targets cannot accept these transfers.
`dispose()` removes the exact listener instances. The dependent command/view composition supplies
actual import/link operations and journal persistence.

The focused six-case Node suite covers identity/spelling, cut completion, partial admission, listener
lifetime, invalid payloads and exact file-handle transport. This boundary has no filesystem effects by
itself. It does not claim actual browser gestures, a native picker, or persistent command completion;
those are qualified with the dependent Explorer host and provider transaction scopes.
