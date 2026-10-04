# Legacy workspace bootstrap

`restoreLegacyWorkspace({storage, legacyStorage, session, onDiagnostic, signal, key, maxEncodedBytes})`
reads the historical browser record through the public versioned recovery migrator. It preserves lazy
membership, editor overlays, protection flags, settings and recovery descriptors. It requests exactly
one session load with `readOnly: true` and `persist: false`; that load boundary must prevent compilation
and physical access until the user regrants the folder. It does not manufacture source bytes for lazy
project or manifest entries.

The return shape is `{restored, blocked, record?, diagnostics}`. An absent record is inert. Invalid,
oversized, unsupported-version, denied-storage or failed-host recovery returns `blocked: true`, retaining
the exact original storage contents. A blocked result must not be replaced by an automatically saved
sample. Cancellation propagates rather than falling through to a replacement workspace. Optional corrupt
explorer/template preferences remain visible as migration diagnostics.

The dependent Studio bootstrap calls this helper and honors `blocked`. This callback contract is
qualified with an injected session boundary; the actual protected Studio entry and browser permission
flow have separate qualification and are not claimed by this standalone helper.
