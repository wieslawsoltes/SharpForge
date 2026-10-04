# Project 16 editor review scope

This is the reusable editor layer of the Project 16 stack. It depends on the text
buffer, Unicode/search/diff algorithms and transactional model foundation. The
application composition and compiler-worker adapters remain in the next layer.

## Stack and source identity

| Role | Revision or branch |
| --- | --- |
| Local foundation | `a780a30f3e0b9c3d5f2f089e8b3fa1c00c90426a`, `codex/project16/01-text-model` |
| Published foundation PR | #3451; published head `d57c385`; merged as `5c6d7f55798314b116efa1bcaabd183a291e37d9` |
| Clean editor closure | `77ec3ffcbb32440ebb6f2168534c056c7721f711` |
| Closure merge in this worktree | `070da438` |
| Final committed editor source snapshot | `4afa8284ab12d6d3c54e711232a35ea8adf2bcb7` |
| Review branch | `codex/project16/02-editor` |
| Planned PR base | `main`, because the foundation dependency has merged |

The clean closure was merged normally into the local foundation. The final
editor files were then copied from the named committed integration snapshot.
This preserves the stack's merge history without bringing the integration
branch's A19 application ancestry into this review. There were no conflict
resolutions that discarded another owner's editor changes.

After that import, this review changes package documentation and example
packaging, registers only present tests, and splits the mixed correction test
file into its eight editor-only cases. The three Studio configuration cases keep
their original assertions in the dependent scope. No uncommitted integration
files, upcoming streaming reader or column-index follow-up was imported.

## Included implementation and evidence

All paths in the source column below are under `packages/editor/`.

| Scope | Source | Focused evidence in this branch |
| --- | --- | --- |
| Virtual editor, line/wrap layout, caret and selection layers, margins, bounded hidden input, bidi/IME composition | `src/core/`, `src/view/`, `VIEW.md` | `tests/a20-view-layout.test.js`, `tests/a20-view-input.test.js`, `tests/browser_a20_view_test.py` |
| Incremental lexical highlighting, folding providers, outlining state and commands | `src/highlight.js`, `src/folding*.js`, `src/view/syntax-index.js`, `src/commands/outlining.js` | `tests/a20-view-incremental-folding.test.js` |
| Shared split models, read-only propagation, atomic history, multi-caret/box/clipboard commands | `src/model.js`, `src/undo.js`, `src/selections.js`, `src/commands/`, `src/view/model-adapter.js` | `tests/editor-model-selections.test.js`, `tests/a20-editor-package-corrections.test.js`, `tests/a20-view-editing-options.test.js` |
| Native VS/VS Code/Sublime/Emacs/Vim profiles, chords, conflict resolution, registers and visual-block commands | `src/keymaps/`, `src/commands/`, `docs/keymaps.md` | `tests/a20-07-keybindings.test.js`, `tests/a20-09-profiles.test.js`, `tests/a20-vim-blocks.test.js`, `tests/editor-vim.test.js` |
| Typed provider registry, cancellation and stale-result guards, atomic workspace edits | `src/services/`, `src/features/context.js` | `tests/a20-editor-services.test.js` |
| Completion, signature help, Quick Info, actions, rename preview, peek, CodeLens, hints, diagnostics and navigation | `src/widgets/`, `src/features/analysis-decorations.js`, `docs/insights.md` | `tests/a20-editor-services.test.js`, `tests/a20-editor-snippets-intelligence.test.js`, `tests/browser_a20_insights_test.py` |
| Snippets, surround-with, smart typing and format triggers | `src/snippets/`, `src/features/smart-typing.js`, `src/features/formatting.js` | `tests/a20-editor-snippets-intelligence.test.js`, `tests/a20-editor-formatting.test.js` |
| Find/replace, incremental search, cooperative literal search and bounded regex worker | `src/features/search*.js`, `src/features/cooperative-search.js`, `src/widgets/find-replace.js`, `src/widgets/incremental-search.js` | `tests/a20-editor-search-diff.test.js`, `tests/a20-editor-cooperative-search.test.js`, `tests/bench/a20-editor-search.mjs` |
| Side-by-side/inline diff and editable three-way merge | `src/diff/` | `tests/a20-editor-search-diff.test.js` |
| Accessibility, options, EditorConfig parsing, bounded file loading, bookmarks, tracking and zoom | `src/a11y/`, `src/options*.js`, `src/editorconfig.js`, `src/large-file.js`, `src/bookmarks.js`, `src/change-tracking.js` | `tests/a20-view-editing-options.test.js`, `tests/a20-editor-package-corrections.test.js`, `tests/browser_a20_view_test.py` |

`packages/editor/VIEW-COVERAGE.md` maps the view issues individually.
`docs/a20-insight-coverage.json` maps 25 intelligence/search/diff leaf issues with
present package tests, deferred compiler tests and explicit capability limits.
`docs/a20-native-keymaps.md` and `docs/vs-inventory.json` record native keymap
coverage and references. Those source mappings do not claim completed browser
or native application parity.

## Qualification status

| Evidence | Result and boundary |
| --- | --- |
| Completed insight source batch, `57d69326` | 43 passed in the source worktree; 36 of those cases are retained in five package test files here. Seven compiler-worker cases are deferred. |
| Completed view batch, `ccdd6894` | 57 passed: 27 focused view cases and 30 existing release regressions. |
| View correction batch, `66f56d88` | 66 passed in its source worktree, including 11 correction cases. This branch retains the eight editor-only correction cases unchanged. |
| 100 MiB search benchmark, `57d69326` | One correct cooperative-KMP result at UTF-16 offset 104,857,583; 1,809.14 ms total, 6,407 slices, median slice 0.241 ms, p95 0.427 ms. Node `setImmediate` backend. |
| Editor review materialization | Static dependency, manifest, package/example path and whitespace inspection only. No new tests, browser session or build run. |
| Browser fixtures | Authored for actual built-package DOM and production HTTP/CSP; not executed because no supported browser was available in the implementation environment. |
| Native IME, screen readers, OS geometry, VS/Vim/Emacs executable oracles | Unverified; JavaScript fixtures and synthetic composition do not qualify these targets. |

These counts overlap; they must not be summed into a new review-branch pass
count. Commands and historical provenance are retained in the owning coverage
documents. `docs/a20-insight-search-benchmark.json` contains the exact source,
machine, command and raw measurements. Its synchronous baseline exhausted its
budget, so it establishes no completed-baseline speedup or browser paint claim.

`tests/manifests/A20.json` registers 21 existing Node files and the two standalone
browser scripts. It retains the foundation and release regression entries.
Qualification remains staged for the complete stack scope, using
`node scripts/limited.js node --test <focused files>` at its scheduled slot and
one completed-scope build before running the browser fixtures.

The static review parsed and linked the public entry, worker, two example entry
modules and 21 manifest test entries with `vm.SourceTextModule`. All 25 roots
linked across 811 modules, including 122 editor modules, without evaluating any
project source. The editor's runtime imports name only `@sharpforge/text` and
`@sharpforge/syntax`. All manifest files, public export targets, package payload
paths, example assets and CSS imports exist. Five Python fixture/launcher modules
parsed successfully. This is dependency and syntax inspection, not test execution.

## Public package and examples

`src/index.js` composes the model, view, commands, keymaps, services, intelligence,
snippets and diff exports. Runtime imports depend only on the declared text and
syntax package entry points. `editor.css` imports each view/widget/keymap/ARIA
stylesheet. The package includes the docs and standalone examples it links.

The examples use external scripts and styles and are served from the built
distribution. `scripts/build.js` rewrites package imports throughout copied
modules, including `features/search-worker.js`. That worker remains an ES module;
the empty classic-worker contribution list is intentional. The example run
instructions are in `packages/editor/examples/README.md`.

## Dependent work and limits

The next application scope supplies the Studio editor host and language-worker
registrations, actual multi-project/session composition, disk permission/save
integration, per-project EditorConfig discovery, keyboard inventory UI and
full-editor browser/performance harnesses. Their helper-dependent tests are not
registered here. The later text/view performance follow-up will carry the
streaming reader and column index once committed and integrated.

Language-specific support remains provider-dependent: type/comment/string/file
rename, Fix All, parameter-name hints and test-status lenses require providers
that advertise those capabilities. Snippet regex transforms fail explicitly.
Workspace edit previews retain their 32,000,000 UTF-16-unit default limit;
cooperative 100 MiB Find is independent of that preview limit. A large regex can
report its bounded safe-search limit, and browser worker execution remains
unqualified. The layer is reviewable without treating those limits as complete
Visual Studio parity or automatically closing the corresponding issues.
