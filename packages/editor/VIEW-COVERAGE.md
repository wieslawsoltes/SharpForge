# A20 editor view implementation and evidence

Source and integration: `codex/p16-editor-view`, qualification checkpoints `ccdd6894` and `66f56d88`.
The view implementation composes the text-engine, native-keymap and editor-insight contributions from their separate worktrees.

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


## Large-file disk integration follow-up (SF-A20-T44, #1513)

The prepared-ingress follow-up adds `src/source-loader.js`,
`apps/studio/workbench/studio-source-reader.js`, project-system source reader and
snapshot writer contributions, descriptor-preserving project membership and
explicit manifest/prefix rebasing. `tests/a20-source-loader.test.js`,
`tests/a20-prepared-source-workspace.test.js` and
`tests/a20-prepared-source-paths.test.js` cover actual Node File/Blob chunk decoding,
UTF-8/UTF-16 BOM and byte boundaries, cancellation, failed preparations, snapshot
saves, disk conflicts and URI/handle rebasing. These follow-up fixtures are
qualified at source `acdf945d`: all 28 new cases passed. Across the complete I/O
scope and its targeted environment repair, 196 distinct cases passed. The first
invocation reported 90 passes and two setup failures because this worktree lacked
the local `@sharpforge/bcl-collections` link; adding that untracked workspace link
unblocked the 105 release04 cases and one CLI ZIP case, all 106 of which passed.
No source changes occurred during qualification. Test execution took 2.182 seconds
for the initial invocation and 5.830 seconds for the targeted retry on Node
24.19.0/Linux; those durations are not editor latency measurements.
Browser timing, physical File System Access and 200 MB interaction budgets remain
unqualified until actual captures exist. See `docs/source-loading.md` and
`packages/project-system/docs/disk-limits.md` for the ownership/public contracts.

Exact completed ingress qualification commands (run only after the full source
batch was frozen, through the shared serial limiter):

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a20-source-loader.test.js tests/a20-prepared-source-workspace.test.js \
  tests/a20-prepared-source-paths.test.js tests/a20-large-file-disk.test.js \
  tests/project-system.test.js tests/workspace-io.test.js tests/release04.test.js
node scripts/limited.js node --test --test-concurrency=1 \
  --test-name-pattern='0.4|CLI ZIP/extraction' tests/release04.test.js tests/workspace-io.test.js
```

| New source-ingress fixture | Passed cases |
| --- | ---: |
| `a20-source-loader.test.js` | 9 |
| `a20-prepared-source-workspace.test.js` | 12 |
| `a20-prepared-source-paths.test.js` | 7 |

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

## Save preparation and encoded round-trip follow-up

Implementation source was complete at `fc4ee84a` before running the completed scope.
The full focused command reached **162 tests: 161 passed, 1 failed, 0 skipped**, in
**15.366 seconds** on Node 24.19.0/Linux. The failed assertion identified a real
selection-boundary error: one combined trim/EOL replacement extended the range
end over the new newline. Correction `54892a70` emits distinct minimal edits and
preserves the expected selection; it adds a final-newline caret regression.
Only the affected normalization/view/configuration files were rerun:
**30 passed, 0 failed, 0 skipped**, in **2.547 seconds**.

Across the completed run and targeted retry, **163 distinct cases passed**,
including all **41 new cases**. This is an eventual union, not a claim of a new
163-case all-green command. Unchanged save/encoding/disk/model paths retain their
passing evidence at `fc4ee84a`; the corrected normalization path is qualified at
`54892a70`.

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/text-cooperative-edits.test.js tests/a20-save-normalization.test.js \
  tests/a20-save-preparation-flow.test.js tests/a20-save-encoding-roundtrip.test.js \
  tests/a20-disk-save-cancellation.test.js tests/a20-source-save-as.test.js \
  tests/text-buffer.test.js tests/editor-model-selections.test.js \
  tests/a20-editor-integration-corrections.test.js tests/a20-view-editing-options.test.js \
  tests/a20-view-input.test.js tests/a20-editor-snippets-intelligence.test.js \
  tests/a20-editor-formatting.test.js tests/a20-prepared-source-workspace.test.js \
  tests/a20-prepared-source-paths.test.js tests/a20-large-file-disk.test.js \
  tests/workspace-io.test.js
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a20-save-normalization.test.js tests/a20-view-editing-options.test.js \
  tests/a20-editor-integration-corrections.test.js
```

| Work ID / issue | Implemented boundary and focused evidence |
| --- | --- |
| SF-A20-T45 / #1514 | `save-normalization.js`, `core/save-preparation.js` and `core/edit-transaction.js` keep no-normalization saves synchronous and source-read-free. Enabled work uses indexed boundaries, bounded windows and private preparation. Current view selections bind at one contribution-aware commit. `a20-save-normalization.test.js` has nine passing cases, including actual 200 MiB source, cancellation, stale source/model/options, limits, read-only transitions, undo and exact content-boundary carets. |
| SF-A20-T01 / #275 and SF-A20-T03 / #277 | `TextBuffer.prepareEditsAsync`, `EditorModel.prepareEditsAsync` and `bindPreparedEdits` reuse the existing persistent tree/commit protocol. Shared inverse construction coalesces ambiguous adjacent inverse insertions. `text-cooperative-edits.test.js` has seven passing cases for private state, large inverse scheduling, cancellation/disposal, source identity, ordered input, CRLF boundaries, ownership and one-step undo. |
| SF-A20-T44 / #1513 | `source-save-as.js` opens the picker before its optional `prepare({signal})` callback and validates the exact replacement capture before stream acquisition. `a20-save-preparation-flow.test.js` has five passing ordering/cancellation/stale-capture/fallback cases; the existing 24-case source Save As suite also passed. |
| SF-A20-T44 / #1513 | Disk baseline reads carry known encoding through `readSource` and `readStudioSource`, including BOM-free UTF-16LE/BE. Shared encoding rejects unpaired surrogates, NUL and ambiguous leading U+FEFF with `SFPROJECT_SOURCE_ENCODING_LOSS`; streams never close on those failures. `a20-save-encoding-roundtrip.test.js` has fourteen passing cases for repeated saves, preflight/no-close negatives, valid BOM/pairs, defaults and exact rebased byte-baseline identity. |
| SF-A20-T44 / #1513 | `DiskWorkspace.save(changes,{signal})` checks queued admission, preflight, baseline reads, permissions, stream acquisition and writes. A started close determines the per-file commit result; cancellation preserves exact partial `written` paths. `a20-disk-save-cancellation.test.js` has six passing cases. |

The historical Save As test that treated lone-surrogate encoding loss as success
was corrected. Valid surrogate-pair/BOM byte assertions remain, and explicit
no-close/no-download diagnostics cover the rejected input.

The actual 200 MiB no-option/trim fixture passed in **1.169 seconds** in the full
run, including model construction. The actual 200 MiB source-output fixture
passed in **7.293 seconds**, including construction, cooperative encoding,
byte-by-byte sink verification and close. Its previous `fe2c20f7` historical
fixture duration was 6.296 seconds. These are single fixture observations from
different source scopes on a shared host, not a controlled median/p95 benchmark
or a demonstrated speedup. The correctness guard adds a bounded validation scan;
quiet performance qualification remains required for a throughput claim.

The Node fixtures exercise real persistent models, Node File/Blob/TextDecoder,
and explicit File System Access/DOM doubles. They do not qualify actual browser
activation/permission dialogs, screen readers, IME, key-to-paint latency, physical
disk durability or 200 MB p95 interaction budgets. Root-owned Studio orchestration
has its own assembled-workspace qualification; these component results do not
claim that it ran. The existing default 100,000-edit transaction limit remains
explicit and rejects excessive normalization atomically.

### Current-target reload follow-up: SF-A19-T41 / #1477 and SF-A20-T44 / #1513

The complete disk observer follow-up at `6d70fa30` passed one serial focused
invocation: **79/79, zero failures/skips, 2.803 seconds**. Its 36 new cases cover
current Save As handles, bounded strict decoding, both BOM states, zero-byte
UTF-16, stale record/version/target guards, cancellation, atomic document/disk
baseline acceptance and native SHA-256 metadata. The other 43 cases are affected
existing regressions. Actual Node temporary filesystem save/reload passed for
all three encodings; browser handles remain explicit doubles. The exact command,
files and qualification limits are recorded in
[the observer evidence](../../apps/studio/workbench/studio-disk-observer.md).
This does not add a browser/oracle claim to the rendered editor rows above or
replace the separately recorded 163-case save qualification.
