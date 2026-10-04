# Editor insights and language providers

`CodeEditor` composes the `createEditorInsights(editor, options)` contribution.
The contribution provides completion, parameter information, Quick Info, quick
actions, Peek Definition, inline rename, CodeLens, inlay hints, reference and
diagnostic presentation, navigation, snippets, formatting, and search. Language
providers return data. The editor owns focus, popup state, cancellation, rendering,
and application of edits.

## Embedding

```js
import {
  CodeEditor, EditorModel, EditorModelWorkspace, createRequestServices
} from '@sharpforge/editor';

const model = new EditorModel('Console.WriteLine(42);', {uri: 'Program.cs'});
const workspace = new EditorModelWorkspace(new Map([[model.uri, model]]));
const services = createRequestServices((method, parameters) => {
  const {signal, ...message} = parameters;
  return compilerRequest(method, message, {signal});
}, [
  'completion', 'hover', 'signatureHelp', 'diagnostics', 'semanticTokens',
  'codeActions', 'prepareRename', 'rename', 'definition', 'references',
  'documentHighlights', 'inlayHints', 'selectionRanges', 'format',
  'formatRange', 'formatOnType',
  {method: 'documentSymbols', remote: 'symbols'},
  {method: 'codeLens', remote: 'referenceLenses'},
  {method: 'folding', remote: 'foldingRanges'}
]);

const editor = new CodeEditor(host, {
  model, workspace, services,
  openDocument: location => documentHost.open(location),
  request: (command, parameters) => commandHost.execute(command, parameters)
});
```

`compilerRequest`, `documentHost`, and `commandHost` in this example are host
callbacks. The complete Studio adapter lives in
`apps/studio/workbench/studio-editor.js`. The worker registration module is
`apps/studio/workers/editor-language.js`; it uses the existing `LanguageService`,
`RefactoringEngine`, and compiler workspace instances. It never commits source.

`new EditorLanguageServices({method: provider})` supplies local providers instead
of RPC. `register(method, provider)` returns an unregister callback. Duplicate or
unknown methods fail with stable `SFED100x` errors. A registry belongs to its
embedding host and can be shared by multiple editor views. Disposing a view
cancels its requests without disposing a registry supplied by the host.

`subscribe(listener)` returns an unsubscribe callback. A host can call
`invalidate('codeLens', {uri})` or `invalidate('inlayHints', {uri})` after provider
state changes without fabricating a source edit. Unchanged CodeLens member lines
retain their existing view zones, so a test-status label update preserves layout.

For compatibility, an editor receiving only the historical `request` callback
advertises `completion` and `hover`. Mutating host commands such as rename and
format must be supplied as explicitly registered, data-only providers; the
adapter does not treat a command which opens a dialog as a language provider.

## Provider contract

Offsets, lengths, edits, and selections use UTF-16 code units. LSP ranges use
zero-based line and character positions. Provider parameters include `uri`, the
captured document `version`, and an `AbortSignal`, together with the
feature-specific parameters below. Providers may return a value or a promise.
List results accept an array or `{items, version}`. Semantic tokens in this
interface are absolute spans rather than LSP delta-encoded integer arrays.

| Provider | Extra parameters | Result |
|---|---|---|
| `completion` | `offset`, trigger character/kind | Items with label, kind, detail, insertion/edit, optional snippet format, additional edits, commit characters |
| `resolveCompletion` | `item` | Resolved documentation and optional item fields |
| `hover` | `offset` | Signature/contents, documentation, optional span |
| `signatureHelp` | `offset`, `callStart`, `activeParameter`, trigger character | Signatures, parameter labels/docs, active overload |
| `diagnostics` | — | URI/version, span or range, severity, code, message, tags, optional quick-fix availability |
| `semanticTokens` | — | Nonoverlapping `{start, end, kind, modifiers?}` spans |
| `codeActions` | `offset`, `end`, optional fix-all `scope`, selected `equivalenceKey` and `action` | Actions with title, kind, children, edit(s), optional command and supported fix-all scopes |
| `resolveCodeAction` | `action` | Resolved action |
| `prepareRename` | `offset` | Rename span/range, placeholder, declaration, version and comment/string/file capabilities, or null |
| `rename` | `offset`, new name, explicit comment/string/file flags | Versioned WorkspaceEdit or flat edits |
| `definition` | `offset`, optional `peek` | Location, array of locations, or `{locations}` |
| `readDocument` | `targetUri` | Target `{uri, text, version, readOnly}`; origin URI/version remain request metadata |
| `references`, `documentHighlights` | `offset` | Absolute locations or ranges; highlight kinds may distinguish reads/writes |
| `codeLens`, `resolveCodeLens` | Lens for resolution | Member spans with count/title/command; unresolved lenses resolve when visible |
| `inlayHints` | — | Position/offset, label parts or text, padding, tooltip |
| `documentSymbols` | — | Flat or hierarchical named type/member ranges, ownership and detail |
| `projects` | — | `{id, name, uri?}` projects applicable to the requested document |
| `folding` | — | Existing folding-range records |
| `selectionRanges` | `offsets` | Nested selection-range records |
| `format`, `formatRange`, `formatOnType` | Selection range, character, indentation options | Versioned text edits |
| `executeCommand` | Command ID and arguments | Host-defined command result |
| `documentationComment` | Provider-defined documentation context | Optional host extension |
| `outlineReorder` | `sourceStart`, `targetStart`, `position: 'before'` or `'after'` | Versioned safe member-move plan; the provider never mutates source |

The active invocation is computed from lexical delimiters, ignoring commas in
comments, strings, nested calls, and collection delimiters. Studio resolves the
signature at `callStart + 1` through the existing language service and retains
the editor's active argument. Signatures therefore remain bound to provider
symbols; the UI does not synthesize a second overload-resolution engine.

Provider documentation is rendered as text. No provider HTML, script, or command
link is injected into the DOM. Completion and CodeLens retain local copies of
items, so frozen or shared provider results are safe to reuse.

## Cancellation and version safety

`AsyncRequestGuard` maintains an independently cancellable generation for each
feature. Starting another request in a channel aborts the previous signal. A
result is delivered only while the originating model, immutable snapshot,
document URI, version, and generation remain current. The guard also checks a
response's version when it refers to the current document. Legacy sources without
an immutable model snapshot are compared by their captured text.

Capturing a model revision does not flatten the persistent source buffer.
Completion edit acceptance, rename preview, and workspace commit still validate
the exact source relevant to their edits. Caret-sensitive completion, signatures,
actions, and definition requests additionally check their captured caret.

Peek reads another document with `targetUri`. Its result version describes that
target, while cancellation and source identity still describe the originating
editor. A different target version is valid. Switching or editing the origin,
closing Peek, changing the selected target, or disposing the editor prevents a
late result from opening an obsolete view.

Host transports should remove `AbortSignal` from a structured-clone message and
use it to cancel the pending RPC. A synchronous compiler request already running
in a worker may finish; the origin guard prevents its obsolete reply from being
published.

## Atomic workspace edits and undo

`prepareWorkspaceEdit(workspace, edit, options)` is side-effect-free. It accepts
flat versioned edits, `{edits}`, LSP `changes`, or LSP text `documentChanges`.
Before returning a plan, it validates every document, write permission, expected
version, span, overlap, replacement text, and optional `expectedText`.
Unversioned LSP changes require versions captured when the request started.

`commitWorkspaceEdit` revalidates the plan immediately before calling the host's
atomic `applyTransaction`. `EditorModelWorkspace` prepares every participating
model, then swaps every root without notifications. Subscribers run only after
all models have committed. An internal participant failure restores every
checkpoint, including selections and undo history, before publishing anything.
A subscriber failure after commit is reported as an `AggregateError`; the source
is already committed and the error message states that fact.

Each affected model receives one undo transaction. An editor without a shared
workspace can use the built-in single-document adapter. An `EditorModelWorkspace`
can accept `{applyResourceTransaction, supportsResourceRename}`. The latter may
be a boolean or a function; it is evaluated before both display and commit.
Versioned LSP rename operations then delegate the entire immutable text/resource
plan to that host, which stages all work before adoption and owns resource undo.
Studio's Explorer adapter does this for browser workspace resources and project
XML; native mode does not advertise atomic resource rename. Creation/deletion
remain unsupported here. The text adapter never applies half of a resource plan.

Default preflight bounds are 100,000 edits and 32,000,000 UTF-16 units per edited
document. Hosts can pass `maxEdits` and `maxDocumentLength` explicitly to
preflight; Studio's general workspace-edit entry uses its larger document limit.
The built-in insight edit paths retain the bounded default. Searching a larger
document remains available independently of that edit-preview limit.

Inline rename temporarily changes the current model using a retained checkpoint
without publishing source-change events. Each new preview first restores that
checkpoint. Cancel restores exact bytes, version, selection, and history.
Commit restores the checkpoint before applying the final atomic workspace plan.
During this preview, the insight context cancels pending language requests and
suspends background provider calls. Only rename may query the restored original
source. This keeps temporary preview versions out of the host's monotonic
semantic workspace; cancellation, commit and disposal release the suspension.
`editor.refreshPreview()` synchronizes the visible text, highlighter and bounded
input context without publishing an extra edit.

Snippet insertion has its own undo stop. `beforeEdit`/`afterEdit` contribution
hooks open an explicit group around each subsequent primary edit and its linked
mirrors. Undo therefore restores every occurrence together. Tab advances fields,
Shift+Tab goes back, choice fields display a picker, and Escape keeps the text.
Supported templates include numbered/nested placeholders, mirrors, choices,
variables, escapes, and `$0`. Regex snippet transforms are explicitly rejected.

Formatting remains a separate undo operation. Semicolon/closing-brace changes,
real clipboard commits with `source: 'paste'`, and completion acceptance schedule
the registered range or on-type formatter. The Studio adapter filters the
existing indentation formatter to the affected lines. It preserves other lines
and source line endings.

## Search and large files

Find and incremental search reuse `@sharpforge/text`'s safe search engine.
Document, captured-selection and all-open-document scopes, case/whole-word
matching, bounded history, capture expansion, preserve-case replacement, match
decorations, and exact replacement preview use the same versioned snapshots.
Selection search examines only the captured selection before applying the match
limit. Returned locations and capture indices are translated back to original
document coordinates, and whole-word checks retain the surrounding source
boundaries.

Incremental search uses `findLiteralMatchAsync` from the current UTF-16 origin,
independently of Find's result-page limit. Typing or shortening a query restarts
at the opening caret; repeated forward or reverse commands start at the current
selection boundary. It reports wrapping only after crossing the corresponding
document boundary. Escape restores the opening range; accepting keeps the
selected match, and neither operation creates an undo entry.

The optional editor `searchNavigation` object configures `maxSteps`,
`timeLimitMs`, `chunkSize`, `matchCase`, `wholeWord`, `wrap`, `clock` and
`yieldControl` for this widget. Defaults are bounded 16,384-unit chunks,
1,000,000,000 steps and a 30,000 ms deadline. Each request owns an abort
controller; a newer query, close or disposal cancels it. A result may navigate
only while its model identity, URI, version and opening search session remain
current. The host navigation callback receives the same cancellation signal.
Budget and navigation failures appear in the widget status without applying a
partial result. These controls bound work, not browser rendering latency.

Small searches run with explicit instruction/time limits. Larger literal
searches use `cooperativeLiteralSearch`: the shared KMP matcher processes bounded
16 KiB slices, preserves nonoverlap and UTF-16 boundary semantics, yields via a
message channel, and checks cancellation between slices. The source is read from
persistent snapshots without requesting the complete editor value. Large regex
queries run in an independently terminable module worker with explicit safe-VM
instruction/time limits. A regex exceeding those limits reports `SEARCH_LIMIT`.

The module worker is `src/features/search-worker.js`. `scripts/build.js` copies
the editor package asset and rewrites its `@sharpforge/text` import to the emitted
relative package entry. It must remain an ESM worker; no classic-worker bundle
contribution is required. A custom bundler must emit that worker and its imported
text modules or supply `searchWorkerFactory`. Document import maps do not apply
inside module workers, so raw source-only HTTP hosting requires that explicit
worker handling. Production CSP is kept intact.

Find exposes completion state on `.sf-find`:

| Attribute | Values |
|---|---|
| `data-search-state` | `searching`, `complete`, `error` |
| `data-search-backend` | `bounded-synchronous`, `cooperative-kmp`, `worker-safe-regex` |

`openFind`, `findNext`, and `findSelected` return the underlying asynchronous
operation. A browser benchmark must wait for `complete`, verify the exact match
and caret, then measure rendering; opening the dialog alone is insufficient.
Replace commands require a completed current search. They reject truncated
results instead of replacing only the first page.

The safe engine's query limit is 1,024 characters and its match limit is 10,000.
Completion retains at most 2,000 provider items and displays at most 200 ranked
items. Hints and lenses are capped at 5,000. Semantic provider requests are
suspended above `maxSemanticCharacters` (default 2,000,000), unless the embedding
host explicitly enables `languageServicesInLargeFiles`; Find remains available.

## Controller and display seams

The controller exposes `complete`, `acceptCompletion`, `closeCompletion`,
`quickInfo`, `signatureHelp`, `codeActions`, `peekDefinition`, `rename`,
`insertSnippet`, `surroundWith`, `format`, `openFind`, `findNext`, `findSelected`,
`replaceCurrent`, `incrementalSearch`, `focusNavigation`, `nextReference`,
`nextDiagnostic`, `setDiagnostics`, and `refresh`. Additional command bindings use
`toggleCompletionMode`, `changeCompletionFilterLevel`,
`decreaseCompletionFilterLevel`, `increaseCompletionFilterLevel`, `peekBackward`,
`peekForward`, `showCodeLensMenu`, `copyParameterTip`, and `pasteParameterTip`.
Clipboard commands use an injected clipboard or the host's browser Clipboard API
and report an unavailable capability explicitly.

The view consumes `setDecorations(owner, items)`, `setViewZones(owner, zones)` and
`setInlineWidgets(owner, widgets)`. Inlay labels never enter the source buffer or
its offsets. A view zone before the first line uses `afterLine: -1`.
`view.coordsAt(offset)` returns coordinates local to `editor.element`, while
`view.positionAt(clientX, clientY)` accepts client coordinates.

Standalone comparison surfaces are exported as `createSideBySideDiff`,
`createInlineDiff`, and `createMergeEditor`. Both diff modes use the same shared
line hunks, show bounded visible rows, and support F8/Shift+F8 navigation.
Side-by-side scrolling uses alignment padding and an overview ruler. The merge
editor exposes left/right/both/manual resolution, unresolved count, editable
result, and undo. Conflict marker bytes remain until an explicit resolution;
manual edits do not silently mark conflicts resolved.

## Qualification and capability boundaries

The original widget-focused Node batch contains 43 passing tests across
`tests/a20-editor-{services,snippets-intelligence,search-diff,cooperative-search,language-worker,formatting}.test.js`.
It covers real model transactions/undo, fake-provider cancellation, actual
language/refactoring endpoints, LSP hint parity, generated read-only sources,
scope/capture/Unicode boundaries, bounded workers, and measured large-file search.

`tests/browser_a20_insights_test.py` exercises the standalone DOM widgets with
real models and fake providers. `tests/browser_a20_view_test.py` exercises the
actual composed `CodeEditor`. Both use the repository's supported
`launch_browser`, selected Chromium/Firefox/WebKit engine, production HTTP server
and CSP, built package modules, CSP-safe waits, and per-suite JSON reports.
Run the build once after the complete scope, then run those scripts. This
workspace has no usable supported browser installation, so these browser
fixtures are authored and syntax-checked, not reported as passing. Native IME,
screen-reader and browser/platform parity remain unverified.

The bound provider now supports source type/member/local/parameter rename,
lexically confined comment/string options and versioned file-rename intent.
Controls use the preparation result's capabilities and the host's resource
capability. Local explicit/implicit type action families supply document,
project and solution Fix All; the Studio coordinator preserves each project's
compiler context and validates the merged plan. Parameter hints use the selected
overload. Actual test-status lenses come from Studio's TestProviders adapter.
These behaviors are qualified by the provider correction scope in
`docs/editor-language-provider-evidence.json`: the initial 141-case run had
three failures, an affected correction run passed 26/26, and the final corrective
run passed 63/63. Every initial failure is covered by a passing affected case.

`tests/browser_a20_language_providers_test.py` adds real CodeEditor, Workspace,
LanguageService and RefactoringEngine UI scenarios for Fix All, exact rename
cancellation, parameter hints and provider invalidation. Its syntax was checked;
it was not executed. The shared production browser setup and engine selection
match the other editor fixtures. No browser, native or Visual Studio oracle pass
is inferred from the Node results.

Fix All is advertised only by action families which implement it. Generated
source stays read-only, unresolved bindings receive no invented hint/reference,
and resource rename requires the host's actual atomic capability.
Documentation-comment generation supplies a generic summary template; symbol-
specific parameter/return documentation remains a language-provider extension.

The issue-by-issue implementation and qualification mapping is recorded in
`docs/a20-insight-coverage.json`. These capability and browser qualifications must
remain visible in PR descriptions rather than being converted into unconditional
Visual Studio parity or issue-closure claims.

The reproducible `tests/bench/a20-editor-search.mjs` benchmark searched a real
100 MiB model snapshot for a trailing marker at offset 104,857,583. On Node
24.19.0/Linux, with nine visible logical CPUs on an AMD EPYC 9V74, the bounded
synchronous baseline reported `SEARCH_LIMIT` after 12.52 ms. The cooperative
search completed correctly in 1,809.14 ms, with 6,407 slices: median 0.241 ms,
p95 0.427 ms, maximum 3.115 ms. This is one full run using Node's `setImmediate`
scheduler; it is not a browser latency measurement or a completion speedup
comparison. Raw fixture identity, command and results are stored in
`docs/a20-insight-search-benchmark.json`.
