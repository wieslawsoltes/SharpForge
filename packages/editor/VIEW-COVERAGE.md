# A20 editor view implementation and evidence

Source and integration: `codex/p16-editor-view`, qualification checkpoints `ccdd6894` and `66f56d88`.
The view implementation composes the text-engine, native-keymap and editor-insight contributions from their separate worktrees.

## Editor review branch scope

Review branch `codex/project16/02-editor` imports the completed editor package from committed
integration snapshot `4afa8284`. The results below are historical source-worktree evidence;
materializing the review branch did not rerun those suites or the build. Its manifest contains only
tests available in the editor/foundation scope. See `docs/project16-editor-review.md` in the repository.

The disk follow-up and Studio configuration helper described below belong to the dependent workbench
scope. Their files and test results are not included in this editor PR. Of the 11 correction cases from
`tests/a20-editor-integration-corrections.test.js`, the eight editor-only cases are retained verbatim in
`tests/a20-editor-package-corrections.test.js`; the three Studio configuration cases remain deferred.

## Executed validation

`node --test tests/a20-view-*.test.js tests/release06-editor-refactoring.test.js`

Result: **57 passed, 0 failed** on Node 24.19.0/Linux. This includes 27 focused A20 view tests and 30 existing regressions.
The run took approximately 1.22 seconds. This duration is test execution, not a keystroke-to-paint benchmark.
All implementation source for this scope was completed before the first focused validation run.

## Qualification limits

The actual-CodeEditor browser fixture is `tests/browser_a20_view_test.py`; its browser execution is pending.
It uses the shared built-package production-server/CSP fixture and browser launch helper.
No native Japanese/Chinese/Korean IME, NVDA/JAWS/VoiceOver, OS high-contrast or native permission-dialog certification is claimed.
Synthetic composition and pure layout fixtures are identified as such. Their success does not establish native platform behavior.
A20 T12 owns browser latency/retained-heap benchmarks. The 100/200 MB latency targets and scrollbar-map frame budget remain unmeasured here.
Huge single-line horizontal extent uses measured monospace estimation outside the bounded rendered fragment; see `VIEW.md`.
Native Unicode/segmentation core qualification is owned by text_engine; completion/hover/peek/find UI qualification by editor_insight.

## Exact issue coverage

Source paths below are relative to `packages/editor/src/`; test paths are relative to `tests/`.

### SF-A20-T02 — #276: Replace the textarea surface with a virtualised line view

Source: `core/code-editor.js; view/virtual-view.js; index.js`.

Evidence: All four a20-view test files; browser_a20_view_test.py.

### SF-A20-T04 — #278: Implement IME bidi and grapheme movement

Source: `core/movement.js; core/editing.js; view/composition.js; view/bidi.js`.

Evidence: Shared text-engine ownership for Unicode algorithms; view integration fixtures.

### SF-A20-T05 — #279: Implement semantic folding and outlining

Source: `folding.js; folding-provider.js; folding-state.js`.

Evidence: a20-view-incremental-folding.test.js; browser fixture outlining actions.

### SF-A20-T11 — #285: Implement accessible editor navigation

Source: `a11y/aria.js; a11y/diagnostics.js; a11y/accessibility.css`.

Evidence: Browser fixture authored; native screen-reader qualification pending.

### SF-A20-T28 — #1497: Add scroll bar map mode and annotations

Source: `view/overview-ruler.js`.

Evidence: a20-view-layout.test.js: first/last marks across 10000 lines; frame budget pending T12 browser run.

### SF-A20-T29 — #1498: Add structure guide lines

Source: `view/structure-guides.js; view/document-layout.js`.

Evidence: Shared fold/tab/wrap geometry; a20-view-layout.test.js zone mapping; browser fixture pending.

### SF-A20-T30 — #1499: Add sticky scroll

Source: `view/sticky-scroll.js`.

Evidence: Caret-aware bounded scope headers; browser qualification pending.

### SF-A20-T31 — #1500: Add word wrap with wrap glyphs

Source: `view/wrap.js; view/document-layout.js; core/movement.js`.

Evidence: a20-view-layout.test.js: complete source and grapheme wrap coverage; browser fixture pending.

### SF-A20-T32 — #1501: Add view whitespace and line-ending glyphs

Source: `view/whitespace.js; view/lines.js`.

Evidence: a20-view-layout.test.js: source unchanged and explicit space/tab/CRLF markers.

### SF-A20-T33 — #1502: Add editor zoom

Source: `view/zoom.js; options.js; core/presentation.js`.

Evidence: Option boundary tests; browser fixture: 175% zoom; native wheel and 20-400% geometry pending.

### SF-A20-T34 — #1503: Add split view of one document

Source: `view/split.js; core/code-editor.js; view/model-adapter.js`.

Evidence: a20-view-input.test.js independent selection adapter; browser fixture shared undo/publish-once.

### SF-A20-T35 — #1504: Add change tracking margin

Source: `change-tracking.js; view/margins.js`.

Evidence: a20-view-editing-options.test.js: unsaved/saved/reverted marks follow undo.

### SF-A20-T36 — #1505: Add bracket pair colourisation and matching options

Source: `view/bracket-colors.js; view/syntax-index.js`.

Evidence: Incremental token fixtures and bounded chunked indexing; browser style qualification pending.

### SF-A20-T40 — #1509: Add bookmark and indicator margin glyphs

Source: `bookmarks.js; view/margins.js`.

Evidence: a20-view-editing-options.test.js: bookmarks follow edits and undo.

### SF-A20-T41 — #1510: Add Edit.Advanced command set

Source: `commands/advanced.js; commands/line-moves.js`.

Evidence: a20-view-editing-options.test.js: Unicode case, disjoint line moves, CRLF, atomic undo, read-only.

### SF-A20-T42 — #1511: Add clipboard ring and drag-and-drop text editing

Source: `clipboard-ring.js; view/input.js`.

Evidence: a20-view-editing-options.test.js: 15-entry ring and atomic drag; input metadata fixtures.

### SF-A20-T43 — #1512: Add overtype mode, virtual space and column guides

Source: `core/editing.js; core/movement.js; view/selection-layer.js; view/structure-guides.js`.

Evidence: a20-view-editing-options.test.js: overtype excludes EOL and virtual spaces materialize on edit.

### SF-A20-T44 — #1513: Add large-file mode

Source: `large-file.js; view/document-layout.js; core/code-editor.js`.

Evidence: a20-view-editing-options.test.js: chunk decode/cancel/invalid UTF8; bounded rows and long lines.

### SF-A20-T45 — #1514: Honour editorconfig and per-language text options

Source: `options.js; editorconfig.js; options-page.js; core/presentation.js`.

Evidence: a20-view-editing-options.test.js: path-specific indentation and save EOL/trim/final newline.

### SF-A20-T02.1 — #1592: Add line layout and measurement service

Source: `view/layout.js; view/document-layout.js; view/wrap.js`.

Evidence: a20-view-layout.test.js: grapheme/tab/wide offsets, wraps and 500000-line map.

### SF-A20-T02.2 — #1593: Render virtualised lines from the buffer

Source: `view/lines.js; view/virtual-view.js; view/document-layout.js`.

Evidence: a20-view-layout.test.js: bounded rows; browser fixture: source-faithful 500000-line DOM.

### SF-A20-T02.3 — #1594: Render carets and selections in a custom layer

Source: `view/selection-layer.js; view/bidi.js`.

Evidence: a20-view-layout.test.js geometry; browser fixture: caret, selection and bidi DOM.

### SF-A20-T02.4 — #1595: Add hidden-input text entry and clipboard bridge

Source: `view/input.js; view/model-adapter.js`.

Evidence: a20-view-input.test.js: clipboard fragments, line copy, model switching.

### SF-A20-T02.5 — #1596: Virtualise the gutter and margins

Source: `view/margins.js; view/folding-margin.js`.

Evidence: browser fixture: virtual margins and breakpoint reveal.

### SF-A20-T02.6 — #1597: Add custom scrollbars with horizontal extent tracking

Source: `view/scroll.js; view/document-layout.js`.

Evidence: a20-view-layout.test.js: indexed map and stale horizontal extent boundaries.

### SF-A20-T02.7 — #1598: Tokenise incrementally from the edited line

Source: `view/syntax-index.js; view/token-runs.js; highlight.js`.

Evidence: a20-view-incremental-folding.test.js: <200-line relex in 100000 lines; release06 regressions.

### SF-A20-T04.1 — #1604: Add grapheme-aware movement and deletion

Source: `core/movement.js; core/editing.js`.

Evidence: a20-view-editing-options.test.js: emoji/grapheme deletion and EOF boundaries.

### SF-A20-T04.2 — #1605: Add word and subword segmentation

Source: `core/movement.js; core/editing.js`.

Evidence: Delegates @sharpforge/text word/subword helpers; text_engine owns segmentation qualification.

### SF-A20-T04.3 — #1606: Render IME composition in the custom view

Source: `view/composition.js; view/input.js`.

Evidence: a20-view-input.test.js: transient commit/cancel/read-only/document-switch synthetic composition.

### SF-A20-T04.4 — #1607: Support bidirectional text

Source: `view/bidi.js; view/selection-layer.js; core/movement.js`.

Evidence: browser fixture: native Range rectangles and bidi visual movement; execution pending.

### SF-A20-T04.5 — #1608: Handle wide characters and tab stops in column math

Source: `view/layout.js; core/selection-commands.js`.

Evidence: a20-view-layout.test.js: tabs, CJK, emoji; shared text engine owns column algorithms.

### SF-A20-T05.1 — #1609: Add folding model with hidden ranges

Source: `folding.js; view/document-layout.js`.

Evidence: a20-view-incremental-folding.test.js: nesting, edit invalidation and hidden mapping.

### SF-A20-T05.2 — #1610: Add syntax and #region folding provider adapter

Source: `folding-provider.js; folding-scan.js`.

Evidence: a20-view-incremental-folding.test.js: typed provider, fallback, abort and stale rejection.

### SF-A20-T05.3 — #1611: Add outlining margin and collapsed hints

Source: `view/folding-margin.js; view/margins.js`.

Evidence: browser fixture: collapsed hints and breakpoint reveal; execution pending.

### SF-A20-T05.4 — #1612: Add Visual Studio outlining commands

Source: `commands/outlining.js; core/command-map.js`.

Evidence: Folding model tests; native-keymap qualification owned by text_engine.

### SF-A20-T05.5 — #1613: Persist collapsed state and reveal on navigation

Source: `folding-state.js; core/code-editor.js; folding-provider.js`.

Evidence: a20-view-incremental-folding.test.js: persisted state and restoration after provider discovery.

### SF-A20-T11.1 — #1637: Expose the virtualised editor through ARIA

Source: `a11y/aria.js; view/input.js`.

Evidence: Bounded native/assistive buffers and native textbox semantics; browser fixture pending.

### SF-A20-T11.2 — #1638: Add accessible diagnostics and breakpoint navigation

Source: `a11y/diagnostics.js; core/presentation.js; view/margins.js`.

Evidence: Browser fixture: range diagnostics and announcements; native speech output pending.

### SF-A20-T11.3 — #1639: Make completion, hover, peek and find widgets accessible

Source: `a11y/widgets.js; features/index.js; widgets/insights.css`.

Evidence: Widget implementation/tests owned by editor_insight; facade composes and disposes contributions.

### SF-A20-T11.4 — #1640: Support high contrast and reduced motion in the editor

Source: `a11y/accessibility.css; view/virtual.css; view/scroll.js`.

Evidence: Browser fixture: forced-colors/reduced-motion emulation; execution pending.


## Historical disk integration follow-up (dependent scope; SF-A20-T44, #1513)

The disk seam lives in `packages/project-system/src/disk/` behind the existing `disk.js` public exports.
It preserves the 2,000,000 default source limit and carries explicit read limits through to saves.
Encoded-byte limits include UTF-8/UTF-16 and BOMs. Total size, baselines, permission rechecks and optional
session versions preflight every write. `packages/project-system/docs/disk-limits.md` records the contract.

`tests/a20-large-file-disk.test.js` adds positive, negative and boundary fixtures. The consolidated run of
that file, `project-system.test.js`, `workspace-io.test.js`, `release04.test.js` and `a20-view-input.test.js`
passed **172 tests, 0 failed**, in approximately 4.53 seconds. File System Access handles are explicit test
doubles, so native browser permission prompts and physical 100 MB disk latency are not qualified by this result.

## Acceptance audit follow-up (qualified at `66f56d88`)

All source was complete before the focused qualification run. On Node 24.19.0/Linux the combined run
passed **66 tests, 0 failed, 0 skipped**, including all **11** new correction fixtures, in approximately
2.182 seconds. The wrapper was reused read-only from the integration worktree because this older
implementation worktree did not yet contain `scripts/limited.js`; its child retained the editor worktree cwd.

```sh
node /workspace/scratch/6b99131ca908/p16-integration/scripts/limited.js node --test --test-concurrency=1 \
  tests/a20-editor-integration-corrections.test.js \
  tests/a20-view-layout.test.js tests/a20-view-incremental-folding.test.js \
  tests/a20-view-editing-options.test.js tests/a20-view-input.test.js \
  tests/editor-model-selections.test.js tests/a20-editor-services.test.js \
  tests/a20-editor-snippets-intelligence.test.js tests/a20-editor-formatting.test.js
```

`tests/a20-editor-integration-corrections.test.js` covers:

- SF-A20-T02 / SF-A20-T34 (#276, #1503): shared-model read-only state, all-pane input/ARIA updates,
  prepared-commit rejection, unchanged version/history, and rollback under a lock.
- SF-A20-T31 (#1500): offscreen wrap invalidation updates row and view-zone geometry without scrolling;
  large ranges remain chunked, and disposal clears queued work.
- SF-A20-T05.2 (#1610): deleting a brace or region marker on one line refreshes actual folding ranges.
- SF-A20-T45 (#1514): a bounded workbench helper reads actual ancestor `.editorconfig` records through
  shared models, applies per-language overlays, resets earlier path settings, rejects malformed/oversized
  input atomically, supports actual project/disk `{path,...}` records without flattening source getters,
  and preserves existing EOLs until explicit normalization is requested.
- SF-A20-T06 / SF-A20-T41 (#280, #1510): deletion retains a caret blocked at the document boundary,
  overlapping word deletions merge, and overlapping whole-line expansions transform every selected line once.
- SF-A20-T44 (#1513): invalid chunk sizes reject before any read or model replacement.

This follow-up does not claim browser, native IME, physical-disk or 200 MB p95 qualification.
