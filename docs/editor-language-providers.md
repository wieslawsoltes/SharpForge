# Source-backed editor providers

This batch completes the semantic provider work for SF-A20-T16 (#1485), T18 (#1487), T19 (#1488), T20 (#1489),
SF-A19-T16 (#1452), and T24 (#1460). It wires the separately owned safe Outline reorder leaf for SF-A19-T20 (#1456).
It does not claim browser, native, or Visual Studio oracle qualification without a corresponding execution report.

## Bound source queries

`Compilation.getSourceModel()` returns one `SourceSemanticModel` for a compilation. `Workspace.sourceModel(options)`
compiles or reuses the current source/options revision and retrieves that model. The query index reuses the compiler's
complete lossless-source `SemanticAnalysis` when already available; otherwise it binds lazily once. It does not emit or
modify executable code and does not infer symbol identity from matching spelling.

The model exposes `symbolAt(uri, offset)`, `referenceAt(uri, offset)`, `documentSymbols(uri)`, `metadataAt(uri, offset)`,
`symbols`, `references`, and `hints`. `records` and `symbolsById` associate plain source records with original bound symbols
for semantic validation. `sources` and `result` retain the analyzed source snapshots and diagnostics. Its data belongs to
one revision and callers must not mutate it. URI lookups are indexed; reference lookup is logarithmic in references per
document. Building the index is linear in bound nodes and declarations plus reference sorting. Rename validation uses
binary searches over prefix edit deltas, avoiding a scan of all edits for every reference.

Language records now retain namespace, fully qualified owner/type names, base types/interfaces, declaration identity,
source version, and read/write/declaration flags. `nameof` retains source identities without adding execution edges, and
method-group references use the selected delegate conversion. Compound updates and `ref` are both reads and writes; `out` is write-only;
receivers of written properties remain reads. Reference-result filters use these flags, including both sides of a compound
update. Class View indexes qualified type owners, preserves partial declarations, and refreshes on source membership/edit
events. Structured external-member hover targets come from bound symbols or the existing framework completion receiver.

## Fix All and solution ownership

Local explicit/implicit type actions expose stable `equivalenceKey` values and the document/project/solution scopes.
`RefactoringEngine.fixAll({uri, version, equivalenceKey, scope, projectId, ownership})` selects one family and validates all
edits together on detached syntax/binding state. Project scopes require `ownership.projects`, each containing an exact
`id` and `documents: [{uri, version}]` list. Unknown families, stale source, overlapping edits, missing ownership, generated
targets, anonymous inferred types, and introduced semantic errors are rejected.
An implicit-type conversion is offered only when the bound initializer's natural type equals the declared type; it does
not remove an implicit numeric conversion such as `double converted = 1`.

`createWorkspaceLanguageActions({projects, documents, getProjectDocuments})` in
`apps/studio/workbench/language-actions.js` provides `codeActions(params, options)` and `rename(params, options)`.
`projects` is the existing `StudioProjects`; `documents` is `DocumentService`. `getProjectDocuments(id)` returns direct
`project.compile` item paths, not the compilation dependency closure. For `$workspace`, it returns the loaded source files.
The coordinator asks isolated compiler workers, merges identical shared-file edits, rejects disagreements, validates the
merged result in each affected compiler context, and checks source/model/project identity again before returning preview
data. Solution source is never combined into a new artificial project merely to perform Fix All.

## Rename and atomic resources

`LanguageService.prepareRename()` returns the selection range, placeholder, source version, declaration location, symbol
identity, and supported `comments`, `strings`, and `file` capabilities. `renamePlan()` returns bound edits and optional
resource intent. `RefactoringEngine.rename()` validates the detached candidate and checks that the edited and untouched
references still bind to their intended declarations. Constructors, partial declarations, aliases, arrays, and generic
type uses follow original source symbol identity. Comment/string edits are confined to lexer spans and whole identifiers.

Rename file is available for a declaring filename that exactly matches the source type. It emits
`{kind: 'rename', oldUri, newUri, version}`. The editor prepares an immutable transaction:

```js
{
  label,
  changes: [{uri, version, before, text, edits: [{start, end, text}]}],
  resources: [{kind: 'rename', oldUri, newUri, version, before}]
}
```

`new EditorModelWorkspace(models, {applyResourceTransaction, supportsResourceRename})` delegates this **entire** plan
when resources are present. It never mutates live text models before the host stages the move. The capability may be a
boolean or a function and is evaluated for both preview controls and commit. Native mode must return false when an atomic
resource transaction is unavailable. The separately qualified `applyExplorerResourceTransaction(plan, {documents,
explorer, signal})` stages cloned edited models, resource moves and owning project XML writes through one Explorer
transaction, with a last source-identity/version/lock check before adoption. Explorer owns resource undo history.
`RefactoringEngine.apply()` rejects a resource action so callers cannot accidentally apply only its text half.

Inline preview still uses a model checkpoint. Each provider request starts from the original source; Escape restores text,
selection, version and undo state exactly. A changed host capability, destination, source version, or project stops commit.
An intervening edit is rejected even if it reproduces the displayed bytes at a newer version. Switching the active editor
model restores only the captured model and prevents another preview from being applied to the replacement document.
The historical `LanguageService.rename()` edit-array API rejects resource intent and directs callers to `renamePlan()`.

## Inlay hints and CodeLens

Parameter hints use the bound call/constructor overload's argument-to-parameter mapping. Explicit named arguments,
synthetic extension receivers, omitted arguments and failed overload resolution do not receive misleading hints. Type
hints remain separate `kind: 1` items; parameter labels use `kind: 2`. Neither changes source offsets.

`EditorLanguageServices.subscribe()` and `invalidate(method, {uri})` let an explicit host refresh provider data without a
source edit. CodeLens invalidation reuses existing view-zone nodes when member lines are unchanged; it changes labels and
commands without relaying out the caret/scroll. Unresolved or disabled lenses cannot dispatch a references action through
Alt+digit. Visible-only resolution keeps its existing source/model generation guard and is cancelled on disposal.
The real TestProviders adapter is separately owned at `apps/studio/workbench/test-code-lens.js` (6bbb1dca); root composition
combines it with source reference lenses and routes its invalidations to `services.invalidate('codeLens', event)`.

## Worker and LSP contract

The worker contribution adds `resolveCodeAction`, `outlineReorder`, and `validateWorkspaceEdit` to the explicit compiler
method registry. `rename`, `prepareRename`, `inlayHints`, `symbols`, `references`, and `documentHighlights` use these source
queries. `validateWorkspaceEdit` validates merged source edits without committing the worker workspace. The LSP adapter
uses the same validated type rename, preparation and read/write highlight behavior; parameter hints retain their existing
LSP positions.

## Focused evidence

| Scope | Authored evidence |
| --- | --- |
| Source symbols, inheritance, references, type rename, hints, Outline wire and metadata hover | `tests/a20-semantic-providers.test.js` |
| All Fix All scopes, isolated compiler contexts, linked files, stale/cancelled batches and dependent-project rename | `tests/a20-fix-all.test.js` |
| Whole resource plan delegation, dynamic capabilities, all-target validation, exact preview restoration and provider events | `tests/a20-provider-transactions.test.js` |
| Existing worker and editor service compatibility | `tests/a20-editor-language-worker.test.js`, `tests/a20-editor-services.test.js` |
| Pure safe Outline planner (shell-owned source) | `tests/a19-outline-reorder.test.js` |
| `nameof` does not change execution/diagnostic semantics | `tests/compiler-binder-csharp6.test.js`, `tests/compiler-binder-csharp6-members.test.js` |
| Actual editor + bound provider DOM flows | `tests/browser_a20_language_providers_test.py` (authored and syntax-checked; unrun) |
| Test registry CodeLens and resource/Explorer adoption | Separate owner evidence in `docs/a20-test-code-lens.md` and `docs/a19-resource-rename.md` |

## Qualification results

The complete source was frozen at `3f1d57b81dc95f45dd507f25fbd589af8c122cec` before the initial focused batch.
That run completed 141 cases: 138 passed and three failed. The failures identified an Outline parser-recovery guard,
an implicit numeric conversion changed by Fix All, and a preview fixture missing the real editor's value facade.
The conversion/preview correction batch passed 26/26. Shell supplied Outline correction `a1153ceb`; the final corrective
batch at source revision `ee32eebc846325b44b29716a9a28a179563a6c3e` passed 63/63, including every originally failing file,
newer-version/model-switch preview guards, final solution-membership validation, `nameof`/delegate references and the
existing C# 6 binder execution/diagnostic cases. The initial run has not been relabeled as an all-pass run.

Exact commands, file counts, Work-ID coverage and independent owner evidence are in
`docs/editor-language-provider-evidence.json`. Every test command used `node scripts/limited.js`. No dependency was added.
No broad build or full repository suite was rerun for these corrections. The new browser fixture passed Python AST and
JavaScript syntax checks but was not executed. Native and Visual Studio/Roslyn oracle qualification remain unrun here.

The supported language profile still determines which expressions can be bound. Parameter hints omit failed overloads;
metadata-only/generated source is read-only. Fix All covers its advertised explicit/implicit local-type families. File
rename requires a matching type filename and the host's whole-plan resource transaction; unsupported native atomic moves
remain disabled. These are explicit language/action/host boundaries, not claims of full Visual Studio parity.
