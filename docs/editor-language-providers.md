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
source version, and read/write/declaration flags. Compound updates and `ref` are both reads and writes; `out` is write-only;
receivers of written properties remain reads. Reference-result filters use these flags, including both sides of a compound
update. Class View indexes qualified type owners, preserves partial declarations, and refreshes on source membership/edit
events. Structured external-member hover targets come from bound symbols or the existing framework completion receiver.

## Fix All and solution ownership

Local explicit/implicit type actions expose stable `equivalenceKey` values and the document/project/solution scopes.
`RefactoringEngine.fixAll({uri, version, equivalenceKey, scope, projectId, ownership})` selects one family and validates all
edits together on detached syntax/binding state. Project scopes require `ownership.projects`, each containing an exact
`id` and `documents: [{uri, version}]` list. Unknown families, stale source, overlapping edits, missing ownership, generated
targets, anonymous inferred types, and introduced semantic errors are rejected.

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
| Test registry CodeLens and resource/Explorer adoption | Separate owner evidence in `docs/a20-test-code-lens.md` and `docs/a19-resource-rename.md` |

The complete source was frozen before the focused Node batch. Results are recorded in the follow-up evidence commit;
this source-ready commit makes no test-pass claim. Browser/native/oracle execution is pending.
