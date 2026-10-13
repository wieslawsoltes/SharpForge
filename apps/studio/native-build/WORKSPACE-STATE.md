# Native context state contract

This independent module applies a fully hydrated native project context to Studio
state. It imports no package and performs no native evaluation, source reads,
metadata fetch, process launch or editor construction.

`nativeCompilationRequest(state)` returns `null` unless native mode and a context
are active. Otherwise it returns copied records for exactly the selected source
URIs, together with the context's compiler options, reference images, assembly
name, output kind, context ID, additional files and analyzer configuration files.
Other open ordinary documents remain editable without becoming semantic inputs.

`applyNativeProjectContext(state, {context, compilation})` requires native mode,
a context ID and a hydrated file array. It atomically replaces the selected
context after its caller finishes authorization and asynchronous hydration.
Generated sources are read-only, obsolete generated documents leave the tab
set, and ordinary open documents survive. Local edits made after the last native
baseline retain their text, version and hash when a fresh ordinary source arrives.
The operation increments the revision and invalidates executable artifacts.

`nativeDocumentReadOnly(state, file)` combines application read-only mode with
individual and generated-document flags. Hosts must use it when constructing an
editor and before applying edits, in addition to their existing save controls.

`createNativeContextHooks(host)` creates callbacks for an owning application. Its
`onProjectContext` first awaits `host.stop()`, checks cancellation, then applies
state and calls optional editor-reset, render, analysis and status callbacks.
`getTestInput(options)` preserves the complete prepared native input, or delegates
to the host's portable project preparation callback with the original options.
The fallback and `getTestSources()` return copied file records.

State holds the authoritative context/options objects; this API does not deeply
clone reference bytes or compiler metadata. The context hydration controller owns
count/byte limits, generation checks and authorization before publication.
This foundation does not register a Studio panel or change the protected entry.
