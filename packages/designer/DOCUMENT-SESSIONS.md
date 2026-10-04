# Document designer sessions

`DesignerSession` and `DesignerSessionRegistry` are data and lifetime APIs. They have no DOM dependency. Studio supplies a rendering
adapter, a source synchronization adapter, and owned host resources. Each URI has a separate `DesignDocument`, undo history, selection,
zoom, editing mode, grid snap setting, preview flag, live attachment, and source synchronization object.

```js
import {DesignerSessionRegistry, probeDesignSource} from '@sharpforge/designer';

const registry = new DesignerSessionRegistry();
const compatible = probeDesignSource(sourceText, 'Views/Customer.cs');
if (compatible.compatible) {
  const session = registry.open('Views/Customer.cs');
  registry.active = session;
  session.setViewState({mode: 'split', orientation: 'vertical', ratio: .6, zoom: 1.25});
}

const recovery = registry.snapshot();
registry.syncFiles(workspaceFiles); // Removal disposes sessions. Tab switches do not.
registry.dispose();
```

## Compatibility and source ownership

`probeDesignSource(text, uri, options)` is a syntax-only gate. It scans with the shared C# lexer and parses candidate signatures using
the shared parser; it does not create `CSharpDesignSession`, execute application code, or construct a preview graph. It accepts a
block-bodied `Create`, `InitializeComponent`, or `Main` containing directly constructed supported controls. Results include
`compatible`, `code`, `reason` / `blockingReason`, `methodName`, `method`, and `span`. Spans are UTF-16 offsets into the original text.
Lexical incompleteness, missing methods, ambiguous construction methods, unsupported file types, and the two-million-character source
limit have distinct stable diagnostic codes. `options.cancellationToken` is the syntax package cancellation contract.
The probe uses the Scanner's explicit `captureTrivia: false` raw-sequence mode: token values and offsets remain available without
retaining whitespace records. The lexer still owns comments, directives, Unicode trivia, lexical diagnostics and cancellation.

A successful probe means that Studio can offer a design view. The subsequent complete source reader still validates the supported
declarative profile and reports source diagnostics. Dynamic expressions remain owned by C#; the probe does not assert that every
statement in a compatible method is editable. Code changes can leave a previously initialized design session showing its last valid
model and blocked synchronization status until source is repaired.

## Recovery and lifetime

The registry snapshot uses `{version: 1, activeUri, documents}`. Each document stores its exact URI, kind, `mode`, `orientation`,
`ratio`, `swapped`, `collapsed`, `zoom`, `scrollLeft`, `scrollTop`, `selection`, `editingMode`, `snap`, and `preview`. URI identity is
case sensitive and never silently decoded or normalized. Recovery clamps finite view values, ignores unsupported versions, filters
removed URIs, and drops unknown node IDs after source initialization. Live attachments and executable objects are never serialized.
Session zoom uses the surface's 0.1–8 range (10–800%); snap spacing uses the guide contract's 0.25–1,024 design pixel range.

The optional `guides` recovery field stores only the validated guide settings and up to 256 named guide positions. Unknown metadata,
malformed values, and newer guide schema versions are ignored. Recovered settings survive the initial placeholder and failed source
parses; `session.applyRecovery({final: true})` completes guide and selection recovery after successful source initialization. Guide
restoration changes no C# text, model revision, or undo entries. Guide edits and guide undo/redo publish a view change so workspace
recovery is saved even when C# remains clean. Reconnecting the same C# document preserves its existing guides. New document option
defaults do not replace recovered metadata.

`registry.close(uri, {preserveState: true})` disposes the live session but keeps a bounded view snapshot for remounting the same file.
The Studio adapter uses this only when replacing a cached source mount. File removal and workspace reset discard those snapshots.

`session.own(name, resource, dispose)` registers one resource; replacement disposes the former resource. Resources are disposed in
reverse registration order. The source-sync object is session owned. A rendering adapter receiving a session therefore disposes its
own visuals without disposing `session.sourceSync` again. `beginOperation(name)` aborts older work in that named channel and returns a
`current()` guard; asynchronous callers must check it before publishing a result. `schedule` and `cancelTimer` provide keyed timers
that cannot outlive their document. After releasing host resources, session disposal closes its current owned `DesignDocument`,
cancels its staged transaction, and clears its history and listeners. An injected document transfers ownership to the session;
document replacement leaves disposal of the previous model to the caller. Disposal continues after a failed cleanup and then
raises `AggregateError`.

## Studio integration

`DesignerDocuments` is composed with `{state, createTools, openSource, resolvePanel, records, onChange, onError, onHistory, sessionOptions}`.
`createTools(session, options)` receives `options.documentHost` and `options.panelResolver`. Each view has its own surface and five
side-panel roots. `DesignerToolRouter` moves the active roots into the shared dock containers; inactive roots remain attached to their
own session. A non-designer document gives the shared tools a neutral empty state.

Call `wrap(uri, sourceRoot, editor)` when creating a source document, `activate(uri)` when focus changes, `sourceChanged(uri)` after a
source edit, and `syncFiles()` when workspace membership changes. Include `snapshot()` under `designer` in the workspace recovery
record, and call `restore(record.designer)` before opening recovered documents. Call `reset()` before disposing the source
editors on workspace replacement. Source tab closure alone should retain its session. A standalone `.sfdesign.json` root can use
`wrap(uri, root, null, {uri, text})`; the record provider keeps that URI in membership reconciliation.

`DesignerDocumentView` exposes `modeBar`, `modeControls`, `layoutControls`, and `commandSlot`. Designer chrome mounts its command bar in
that slot and can move the existing controls into its overflow-aware layout. The source editor and design surface stay mounted while
the per-document splitter changes visibility and flex ratios. No mode change calls the docking model. The splitter supports pointer
drag, Escape cancellation, orientation-correct arrow keys, Shift for larger steps, Home/End limits, and double-click reset.

`onHistory(uri, redo)` is an optional synchronous claim of a source undo transaction. Only a literal `true` consumes the source
editor's Ctrl/Cmd+Z/Y event; ordinary typing undo remains with `CodeEditor`. View Designer / View Code command contributions use the
same tab and the same compatibility predicate as the Solution Explorer entries.

The legacy `sharpforge.designer` automation facade resolves the active document at each call. `disconnect()` is cleanup: it is safe
before the first source link, after a previous disconnect, or while an incompatible document is active. With no active designer it
returns `undefined` without opening a document or changing inactive sessions. With an active designer it cancels that document's
source link and retains its model. Source reads/writes and authoring commands still require an active compatible document; cleanup
failures from an active source adapter are propagated.

## Validation scope

`tests/a18-session-*.test.js` covers session isolation, bounds, cancellation, disposal, recovery, compatibility, layout migration, and
command routing. `tests/browser_designer_documents_test.py` drives the real Studio and its worker-backed compiler with two separately
docked source documents. The default HTTP backend tests actual reload; the restricted in-memory backend reports a recovery roundtrip
instead. `node tests/a18-session-probe-benchmark.js` records the machine/runtime and median/p95 timings for the existing complete
source session versus the compatibility gate on a deterministic 2,000-line file. Browser/engine results must be reported from an
actual run; these source files alone do not establish a passing platform matrix.

The shipped `samples-designer.js` catalog also contains `edit-continue-structure`, a console-only methods/fields example with no
WinUI construction. It is deliberately classified as incompatible, just like ParticleLab. The four GUI examples have compatible
construction sources; wrapper `Program.cs` files that only call `DesignedView.Create()` retain Code view. A catalog membership alone
does not establish that a file owns a declarative visual tree.
