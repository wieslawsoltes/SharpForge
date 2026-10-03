# Source component previews and Studio transactions

## Capability boundaries

The compiler remains authoritative about executable support. Class inheritance currently reports the existing `SF1014` and `SF2200`
errors. A visual preview does not remove, downgrade, or convert either error into a successful compilation.

| Result | Compiler success | Document authoring | Source writes |
| --- | --- | --- | --- |
| Closed supported construction | Required | Enabled | Compiler-validated atomic transaction |
| Proven direct inherited component | False, errors retained | Read-only | Blocked |
| Closed factory composing proven components | False, errors retained | Read-only | Blocked |
| Closed construction with only owned lowered-event profile errors | False, errors retained | Read-only; existing handlers navigate | Blocked |
| Guarded native resource class | False, errors retained | Staging and export enabled | Blocked pending native-target qualification |
| Other errors or unproven construction | False | Last accepted preview retained | Blocked |

`designPreviewCapability(analysis)` accepts raw analysis or its `designSourceSnapshot`. A successful capability has
`kind: 'component'`, `previewAvailable: true`, `readOnly: true`, and `sourceWrites: false`. It requires the exact existing inheritance
profile diagnostics, a closed typed construction, and source evidence that the selected instance method assigns its root to
`this.Content` or `this.Child` on a directly registered framework base. Unsupported dynamic expressions, indirect project inheritance,
detached construction, and additional compiler errors remain barriers. The descriptor retains the actual owner, URI, content assignment,
base declaration, UTF-16 spans, and preview/navigation capabilities.

`DesignerRootRegistry.registerPreview(descriptor, analysis, {analysisVersion})` rechecks this capability and the descriptor identity.
It stores the separate `wrapDesignPreviewRoot` document whose synthetic owner matches the declared framework base. The source document
keeps only real source-owned nodes. The synthetic document has `previewOnly: true` and the source planner rejects it. Ordinary
`register` still requires successful compilation and rejects preview descriptors or synthetic preview documents.

Registry projection checks expected component URI and base type. A later workspace/catalog revision replaces the registry and cancels
pending requests. An old named-class result cannot populate the new registry. Projection retains node/depth bounds and component-cycle
diagnostics; previews do not execute user constructors or handlers.

## Closed factory composition

`designComposedPreviewCapability(rawAnalysis, componentAnalyses)` is deliberately a worker-side proof. It requires raw compiler context,
not a client-supplied list of control names. It qualifies a parameterless static `Create` whose last statement returns its explicitly
owned framework root. Every project child must have a separately proven direct component body from the identical source URI, text,
version, and edit-permission set.

Each component must also declare a parameterless constructor whose sole statement calls the selected instance construction method.
Field initializers, static constructors, unknown component descriptors, nested unproven components, constructor work beyond that call,
and host overrides of the component's content are not qualified. This prevents a `Page` containing `new Widget()` from displaying a
method that the Widget constructor never invokes. A successful proof has `kind: 'composition'`, a bounded dependency descriptor list,
and the same read-only/source-write restrictions as a direct preview. Rejection includes a concrete reason.

The Studio worker discovers candidates through `projectControlCandidates`, then analyzes each named class against the actual source
set. `discoverPreviewProjectControls` receives only individually proven descriptors and a failed compilation marker. Successful and
preview-only catalogs use separate UI routes; the latter displays the visible Preview only label. Caller-provided metadata is never
allowed to turn an unrelated compiled class into a visual control. Both analysis and planned insertion check every used project type
against the current compilation's source catalog.

## Read-only models and preview refresh

`DesignDocumentCore.setReadOnly(value, reason)` publishes a capability event without changing the document revision or history.
Authoring through `change`, undo/redo, and transactions fails with `SFD1865`; an active staged transaction is cancelled. Selection,
source refresh through `load`, and explicit unlock remain available. Studio sets this state only from `analysis.readOnly === true`.
`canApply: false` alone never locks a resource document because guarded resource editing intentionally supports staging and export.

`DesignSyncProtocol.accept` retains its original strict validation. The separate
`acceptPreview(token, {document, success: false, capability, diagnostics, ...versions})` accepts only a source-read token and a
capability that prohibits source writes. Component/composition/event modes require read-only authoring. Resource mode requires
`kind: 'resources'`, `readOnly: false`, and `stageDesign: true`. Errors continue to keep the synchronization state blocked, while the
source baseline and visible preview advance to the accepted revision. Source-write tokens cannot use this route. Repairing C# to a
supported compilation takes the normal strict acceptance route and unlocks authoring.

`designProtectedEventPreviewCapability(rawAnalysis)` also permits a narrowly defined `kind: 'events'` preview. Every compiler error must
be the exact `SF2200` framework-events-with-lowered-delegates profile diagnostic, and its URI/span must fit an independently owned event
statement in the selected construction. There must be at least one protected subscription. The construction cannot contain project
nodes, dynamic properties/collections, detached nodes, or other handwritten statements. At most 4096 subscriptions are considered.
Other C# errors, other profile errors, and diagnostics outside those statements remain barriers. The event handlers are not executed.

Existing handler navigation returns `navigationAvailable: true` separately from compiler `success`. Studio checks the actual worker's
zero-edit result and current source URI/text/version/permission set before opening the subscription. Failed compilation stays failed,
and navigation neither accepts a source transaction nor clears blocked status. Hosts without worker services can navigate an exact
retained source location. Both paths report `existing: true` and preserve the actual compilation result.

## Cache identity and cancellation

`analyzeDesignSources(files, {reuseAnalysis, ...selection})` can share immutable parsed/semantic data when analyzing another owner in
the exact same source context. It still chooses the requested class and method, recomputes its partial fields, and reads its owned
construction separately. Any URI/text/version/permission or compiler-option difference prevents reuse. An explicitly supplied semantic
context also prevents reuse of another analysis. This avoids repeated compilation of the same candidate set without sharing mutable
construction state between documents.

The per-worker analysis cache includes workspace, selected URI/class/method, compiler options, assembly/extensions context, complete
project descriptors, and previous document/identity data. It verifies all source snapshots before reuse. Defaults retain at most four
analyses and 512,000 UTF-16 code units of source plus cache-key data. Oversized candidates remain analyzable within existing source
limits but are not retained. No speedup is claimed before the scheduled measurements.

Studio sends cancellation as the third argument to `compiler.request(method, params, {signal})`; `AbortSignal` is never serialized into
feature parameters. The generic compiler transport supplies the worker handler with `{signal, requestId}`. The designer's bounded
queue defers analysis/catalog requests by one event-loop turn and drops obsolete queued reads only within the same
workspace/request-owner/URI/class/method stream. Plan/event requests do not coalesce. Disposal cancels queued work and removes listeners.

Cancellation promptly releases the caller's wait. It does not forcibly interrupt a synchronous compiler that is already running and
does not terminate a shared compiler worker. Source-version, workspace-revision, document-revision, and generation checks remain the
final commit barrier even when a completed result races with cancellation. Resource requests share transport cancellation; resource
decoding remains synchronous once dispatched.

## Normalized writeback and owning-project receipts

After a source plan compiles and its version-guarded edits commit, Studio accepts `plan.document`, retains only matching runtime
bindings/editor metadata, and loads that normalized document. The protocol baseline and atomic history refer to the same compiled
candidate. In particular, moving a child from Canvas to Grid removes obsolete Canvas attached properties from both C# and the model.
Undo/redo restores source and design together while preserving current guide/sample metadata on surviving matching node identities.

The app-host compile callback captures the exact owning-project input before awaiting the build and returns its `compilationUris` on
success. The full workspace source projection remains available for freshness checks. Compilation of another project cannot authorize
source edits in an excluded file. Main-runtime attachment reads the source-evidence-aware `runtimeState` callback when provided.

New document creation applies `initializeDesignerDocumentOptions` before saving/opening the new document. Existing, recovery, and
source-read paths keep their own guide metadata. Final session recovery remains at the source-initialization boundary.

## Prepared qualification

The current integration adds focused source/worker/Studio tests in:

- `tests/a18-studio-component-preview.test.js`: actual inherited diagnostics, direct registry wrapping, constructor-proven static host
  composition, source-revision/content barriers, stale root loads, and rejection of fabricated project metadata.
- `tests/a18-studio-worker-context.test.js`: semantic reuse, exact cache invalidation, same-file/different-class plans, permission changes,
  bounded queued cancellation, coalescing, and disposal.
- `tests/a18-source-preview-state.test.js`: model guards, strict versus preview acceptance, source repair/unlock, and stage-editable
  resource refresh through the production resource decoder.
- `tests/a18-studio-normalized-write.test.js`: the production compiler worker, source services, editor transaction history, and
  Canvas-to-Grid normalized write/undo/redo with retained guide/runtime metadata.

The first combined gate exposed the native parser-token versus AbortSignal mismatch and the protected lowered-event profile gap.
The follow-up adds `tests/a18-source-cancellation-adapter.test.js` and `tests/a18-source-protected-event-preview.test.js`. Native syntax
tokens retain their polling/deadline behavior; AbortSignal is adapted through the syntax package's exported `CancellationToken`.
The follow-up regressions cover live/canceled signals, cancellation during parser polling, exact profile/span rejection, protected
worker navigation with compiler errors retained, and source-repair unlock. Follow-up tests remain pending the next coordinated run.

These tests were prepared before the single combined validation gate requested for the complete scope.
The compiler-worker tests require the async cancellable transport commit `53653c52`. Browser responsiveness and native WinUI execution
are separate qualification targets; inherited/native-resource source is not reported as executable on SharpForge's current profile.
