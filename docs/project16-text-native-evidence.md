# Project 16 text engine, native commands, and keyboard evidence

This ledger records the work owned by `codex/p16-text` and the native command
qualification delegated to it. It describes implemented source and observed
checks; it does not close issues or substitute Node fixtures for browser,
desktop-editor, operating-system, or assistive-technology qualification.

The exact-column runtime-source revision is **`e43c811e`**, following the completed
visual-column scope at **`e688ce9c`** and Surround With regression **`5d4b79f2`**.
Native/block evidence remains at **`de8eeff3`**, with original text foundation
evidence at **`e87dedf4`**. Both use the production JavaScript
`TextBuffer`, `EditorModel`, selection and undo implementations. The headless
editor fixture supplies view, host-provider, and clipboard seams, and retains no
second copy of document text. Root integration owns final package/build gates,
test-manifest registration, stacked publication and the complete browser matrix.

## Observed verification

### Origin-based search corrections awaiting integrated qualification

The complete correction batch for **#1600 / SF-A20-T03.2** and
**#1507 / SF-A20-T38** replaces capped-prefix navigation with the shared
`findLiteralMatch` / `findLiteralMatchAsync` API. Add Next Occurrence preserves
the explicit 10,000-selection capacity. Incremental search owns cancellation
and rejects stale model, version or session results before navigation.

`tests/a20-search-navigation.test.js` covers more than 10,000 earlier matches,
both directions and wrap boundaries, overlapping matches, UTF-16 chunk seams,
whole-word/exclusion behavior, limits, cancellation, captured snapshots and
selection capacity. Its 200 MiB case is a **virtual indexed ASCII source** that
asserts bounded nearby reads; it is not an allocated-file or browser latency
measurement. `tests/a20-incremental-search-navigation.test.js` uses the actual
widget search methods with real `EditorModel` state and explicit view/host
seams, including query extension, Escape/accept, failure, stale results,
supersession and disposal.

No tests, checks, builds or benchmarks were run while authoring this batch.
Root owns one affected-scope qualification after all corrections are complete.
The existing `tests/text-search-regex.test.js` and
`tests/editor-model-selections.test.js` belong in that run because the scalar
KMP implementation and multi-caret consumer are shared. Earlier measurements
below describe their named revisions and do not qualify these new changes.

Runtime: Node.js **v24.19.0**, Linux x64. The buffer benchmark identifies the
CPU, workload and measurements in
[text-buffer benchmark evidence](../packages/text/bench/results.md).

The complete native/keyboard/block/model scope passed at `de8eeff3`:

```sh
node scripts/limited.js node --test --test-reporter=spec \
  tests/a19-studio-keyboard.test.js \
  tests/a20-07-keybindings.test.js \
  tests/a20-09-profiles.test.js \
  tests/editor-vim.test.js \
  tests/a20-vim-blocks.test.js \
  tests/editor-model-selections.test.js
```

Result: **233 tests: 225 passed, zero failed, eight explicitly skipped**. The
VS Code table includes **99 distinct behavioral shortcut fixtures**. The new
visual-block file contributes 23 passing cases; the model file has ten passing
cases, including nested undo groups and bounded rectangular insertion.

At `e87dedf4`, all **55 then-new text/model tests** passed after the complete
foundation scope was implemented:

```sh
node --test tests/text-buffer.test.js tests/text-search-regex.test.js \
  tests/text-unicode.test.js tests/text-diff-merge.test.js \
  tests/editor-model-selections.test.js
node --test tests/release04.test.js tests/release05-editor-refactoring.test.js
node packages/text/bench/buffer.js
```

The legacy command passed **126/126** tests at that revision. These historical
commands preceded the subsequently merged resource-limit policy. Current runs
use `scripts/limited.js`; the historical legacy result is not a claim that the
entire current repository test suite was rerun. There are now 57 text/model cases
across the original four text files and the ten-case model file; the two added
model cases were observed in the current combined run.

The scale and oracle checks are substantive:

- 100,000 deterministic mixed CR/LF/CRLF, emoji, combining, and lone-surrogate
  edits are compared to a string after every operation. Every nineteenth edit
  additionally compares line starts, positions and slices against `SourceText`.
  Retained immutable snapshots and tree height are checked.
- The large-boundary fixture contains **104,857,600 UTF-16 code units**. Slicing
  around CRLF and an emoji leaves the persistent snapshot's full-text cache
  unmaterialized, including after changes to the live table.
- One million CRLF-terminated lines receive start, middle and end edits. The
  observed edit-only p95 values were 0.010686, 0.012549 and 0.010996 ms. They are
  below the two-millisecond acceptance ceiling on the measured machine.
- A 500 KB document retains 1,000 one-character undo groups with 1,000 retained
  payload characters. Another fixture checks 500 randomized undo/redo steps.
- Twenty-one small supported regex patterns are compared to the host's native
  regex result as a reference. A separate child-process watchdog verifies
  pathological expressions terminate inside the bounded interpreter.
- Three thousand randomized diffs reconstruct the desired text and agree with a
  dynamic-programming minimum oracle; merge conflict payloads and offsets are
  compared exactly.

The source checks at `de8eeff3` were:

| Check | Observed result | Integration implication |
| --- | --- | --- |
| `git diff --check` before commit | Passed | No introduced whitespace errors. |
| `npm run check:structure` | Exit zero; 257 existing/other-scope findings | None of the reported paths are this ledger's new or modified text/model/native/StudioKeyboard modules. The report remains advisory in this repository revision. |
| `npm run check` | Exit one: 34 unassigned Project 16 test paths | The runner stops at test-manifest registration. Root owns the aggregate manifest update; this result does not establish a passing required `core` gate. |

No full build, full current unit matrix, browser engine, native executable, or
screen-reader pass is claimed by this branch. Source was completed before each
focused validation batch. The measured host was shared with other agents; local
latencies do not establish fixed CI hardware guarantees.

## Large source Save As follow-up

Complete source at **`fe2c20f7`** adds `apps/studio/workbench/source-save-as.js`,
its adjacent API contract, and `tests/a20-source-save-as.test.js`. It reuses the
public streamed workspace encoder from view's completed `acdf945d` dependency,
merged as `66ba8164`. It owns no changes to `studio.js`, `StudioSave`, document
dirty-state logic, or disk-handle registration; root/session integration supplies
the captured record and interprets the result against current identity/version.

| Work ID / issue | Implementation | Evidence and acceptance boundary |
| --- | --- | --- |
| SF-A20-T44 / [#1513](https://github.com/wieslawsoltes/SharpForge/issues/1513) | `apps/studio/workbench/source-save-as.js`; `fe2c20f7` | Captured immutable source, immediate native picker, streamed close/abort, encoding/BOM preservation, byte caps, and explicit download-only outcomes. This covers large-source output; opening/scrolling/editing p95 and real browser file permissions remain separate view/root qualification. |

The complete focused command was:

```sh
node scripts/limited.js node --test --test-reporter=spec tests/a20-source-save-as.test.js
```

Result: **24 passed, zero failed, zero skipped**, **6.496 seconds** on Node.js
v24.19.0/Linux x64. The 200 MiB ASCII fixture wrote **209,715,200 bytes** through
**3,200** native-stream chunks. Every byte was checked; source reads stayed
within 65,537 UTF-16 units, the sink retained no output buffers, the source's
whole-text cache stayed unmaterialized, and a task ran between chunks even with
a synchronous sink. The **6.296-second** fixture includes source construction,
encoding, cooperative yields and output verification. It is not a browser
latency, storage-throughput, retained-memory or physical-durability measurement.

The same file covers a live-buffer/captured-wrapper race while the picker waits,
all supported encodings, empty BOMs, surrogate seams, cancellation during stream
acquisition/pending writes, permission/write/close failures, post-first-chunk
byte limits, cleanup failures, and fallback Blob/link/URL behavior. Downloads
always return `ok:false`; exporting cannot silently clear a document's dirty
state. A successful native result includes actual encoded `byteLength`, the
chosen `handle.name`, and the original captured source identity/version.

`git diff --cached --check` passed before source commit. `npm run
check:structure` exits zero with **256 existing/other-scope findings** and none
for the new Save As paths. `npm run check` stops at **60 unassigned aggregate
test paths** in this implementation worktree, including the new A20 test. Root
owns final integrated registration and required gates. No other tests or build
were run for this completed follow-up.

## Exact columns and Surround With follow-up

After complete source at `5d4b79f2`, one limited invocation ran
`text-visual-columns`, `text-unicode`, `editor-model-selections`,
`a20-surround-with-shortcut`, `a20-07-keybindings`, `a20-09-profiles`,
`editor-vim`, `a20-vim-blocks`, `a20-view-layout` and
`a20-view-editing-options` (all paths under `tests/`, suffix `.test.js`).
Result: **261 tests, 252 passed, zero failed, nine explicit skips**, 4.586 seconds.
The ninth skip is the full native Unicode16 Intl oracle: this Node host supplies
Unicode17. It is separate from the eight documented Vim targets below.

At `e43c811e`, a specific existing-fixture comparison against the actual Intl17
host was added and disposed-model lookup errors were made explicit. The complete
`tests/text-visual-columns.test.js` file was rerun through `scripts/limited.js`:
**11 tests, ten passed, zero failed, one explicit Unicode16-host skip**, 2.428
seconds. No browser/OS matrix or unrelated native behavior was rerun in this
correction invocation.

The official fixture has **1,093** Unicode16 extended-grapheme rows; all pass.
The exact-column tests enforce a **209,715,200 UTF-16-unit single line**, bounded
reads of at most 4,097 units, cooperative yielding, exact nearby/cached answers
and no lazy whole-text materialization. A multi-megabyte unfinished combining
cluster verifies constant-size cluster state. Changed lines reuse prefix
checkpoints; earlier-line edits relocate unaffected indexes; silent checkpoint
rollback, undo/redo, stale work, cancellation and disposal preserve correctness.

The [visual-column benchmark](../packages/text/bench/visual-columns-results.md)
records thirty 1Mi-unit samples: full-prefix median **61.508594 ms** and p95
**68.025205 ms**, versus sparse-index lookup median **0.129756 ms** and p95
**0.265230 ms**. Initial async indexing took **25.040206 ms** across 15 yields.
These are shared-host model measurements, with no browser frame-latency claim.

`git diff --check` passes. `npm run check:structure` still reports the same 257
other-scope findings and no modified column/grapheme/model path. `npm run check`
stops only at **38 unassigned aggregate test paths** in this implementation
worktree; root owns final registration. The separate foundation review worktree
at `a780a30f` has its five present foundation test files registered and passes
repository-wide manifest discovery; no full core/build pass is claimed there.

## Text storage, model and history

Paths below are repository-relative. “Qualified” means the named implementation
was exercised by the focused tests above; joint UI criteria remain with their
explicit integration owner.

| Work ID / issue | Implementation | Evidence and acceptance boundary |
| --- | --- | --- |
| SF-A20-T01.1 / [#1585](https://github.com/wieslawsoltes/SharpForge/issues/1585) | `packages/text/src/piece-tree.js`, `piece-table.js`; `a3e603bd` | `tests/text-buffer.test.js`: persistent AVL storage, 100,000 edit/string oracle, retained roots, balanced height, and 100 Mi-unit boundary slice without full materialization. |
| SF-A20-T01.2 / [#1586](https://github.com/wieslawsoltes/SharpForge/issues/1586) | `packages/text/src/line-index.js`, indexed summaries in `piece-tree.js`; `a3e603bd` | Same suite compares mixed-EOL line starts and UTF-16 coordinates to `SourceText`, including edits joining/splitting CRLF across pieces. |
| SF-A20-T01.3 / [#1587](https://github.com/wieslawsoltes/SharpForge/issues/1587) | `packages/text/src/buffer.js`; `a3e603bd` | One version per disjoint edit batch; immutable before/after snapshots, exact change/inverse ranges; stale, overlapping, invalid and disposed edits rejected. |
| SF-A20-T01.4 / [#1588](https://github.com/wieslawsoltes/SharpForge/issues/1588) | `packages/editor/src/undo.js`, `model.js`; `96931f4f`, `9c9a5248` | `tests/editor-model-selections.test.js`: randomized round-trips, command/time coalescing, save-state identities and explicit nested groups that include selection jumps and individual undo stops. |
| SF-A20-T01.5 / [#1589](https://github.com/wieslawsoltes/SharpForge/issues/1589) | `packages/editor/src/model.js`; `96931f4f` | Lazy text access, model-owned buffer/history, separate selection notifications, checkpoint rollback and no-notification transaction preparation/commit. Binding actual `CodeEditor` and per-URI documents is jointly implemented by view/session owners. |
| SF-A20-T01.6 / [#1590](https://github.com/wieslawsoltes/SharpForge/issues/1590) | `packages/text/src/eol.js`, buffer metadata; `a3e603bd` | `tests/text-buffer.test.js`: mixed and dominant endings, final-newline state, UTF-8 and UTF-16 LE/BE BOM encoding/decoding. UTF-16 preserves unpaired surrogates; standard UTF-8 encoding replaces invalid scalar input. |
| SF-A20-T01.7 / [#1591](https://github.com/wieslawsoltes/SharpForge/issues/1591) | `tests/text-buffer.test.js`, `packages/text/bench/buffer.js`, `results.md`; `e87dedf4` | Required random/large-buffer tests and local million-line p95 pass. Same-machine CI and browser timing remain separate qualification. |
| SF-A20-B02 / [#1480](https://github.com/wieslawsoltes/SharpForge/issues/1480) | Operation payloads and linked undo groups in `undo.js`; `96931f4f` | A thousand one-character history steps do not retain a thousand 500 KB source strings. The assertion uses actual retained payload statistics. Shared-buffer/model retained-memory measurements are additionally owned by T12. |

The public text API retains `SourceText` and `findTextMatches` compatibility.
`TextBuffer` supports both `{start,end,text}` and
`{start,deleteCount,text}` edits, zero-based line/character positions, JS-style
`substring`, strict `getText`, line access and lazy snapshots. Prepared changes
allow workspace-wide validation and rollback before notifications are exposed.
Direct mutation of `.buffer` intentionally bypasses editor history; UI commands
use `EditorModel` or the view's transaction facade.

## Selections, Unicode and clipboard geometry

| Work ID / issue | Implementation | Evidence and acceptance boundary |
| --- | --- | --- |
| SF-A20-T03.1 / [#1599](https://github.com/wieslawsoltes/SharpForge/issues/1599) | `packages/editor/src/selections.js`; `96931f4f` | Model tests cover deterministic overlap/touch merging, primary direction, sorted ranges, transform affinity and both `active` and `head` aliases. |
| SF-A20-T03.2 / [#1600](https://github.com/wieslawsoltes/SharpForge/issues/1600) | `packages/editor/src/commands/multi-caret.js`; `68885522` | Add/remove/collapse carets, next/all occurrence and line-end carets are checked through actual selection and edit results. Native VS Code/Sublime suites reuse these commands. |
| SF-A20-T03.3 / [#1601](https://github.com/wieslawsoltes/SharpForge/issues/1601) | `commands/box-selection.js`; `68885522`, `de8eeff3` | Rectangular typing, partial tabs, wide clusters, virtual space and bounded insertion are model-tested. `a20-vim-blocks` exercises the same geometry through modal commands. Pointer drag and browser arrow delivery are view-owned. |
| SF-A20-T03.4 / [#1602](https://github.com/wieslawsoltes/SharpForge/issues/1602) | `commands/multi-clipboard.js`; `68885522`, `de8eeff3` | Versioned fragment MIME data, distributed paste, line copy, rectangular rows and beyond-EOF growth round-trip. Permission, stale selection and disposal cases are covered by profile/Vim suites; actual OS clipboard integration remains browser qualification. |
| SF-A20-T03.5 / [#1603](https://github.com/wieslawsoltes/SharpForge/issues/1603) | Shared `EditorModel.applyEdits`, `undo.js`, multi-caret/box commands | Five-carets typing restores exact selections in one undo; block change/insert/paste and native macro groups use the same history. |
| SF-A20-T04.1 / [#1604](https://github.com/wieslawsoltes/SharpForge/issues/1604) | `packages/text/src/graphemes.js`, `grapheme/*`, native movement/Vim modules; `65da4467`, `de8eeff3`, `e688ce9c`, `e43c811e` | All 1,093 official Unicode16 extended-grapheme rows pass. Existing editor fixtures also agree with actual Intl17. Native suites preserve combining/ZWJ/flag/Hangul/Indic/CRLF and non-BMP movement/deletion behavior. |
| SF-A20-T04.2 / [#1605](https://github.com/wieslawsoltes/SharpForge/issues/1605) | `packages/text/src/words.js`; `65da4467` | Word/subword tests cover CJK, acronym/camel humps, digits and underscores. Word services are explicit/injectable. No desktop Visual Studio word-navigation oracle was executed. |
| SF-A20-T04.3 / [#1606](https://github.com/wieslawsoltes/SharpForge/issues/1606) | View owner: `view/composition.js`, `view/input.js` | Outside this branch's DOM implementation assignment. Native shortcut tests verify composition is not intercepted, which is not an IME rendering or OS-input qualification. |
| SF-A20-T04.4 / [#1607](https://github.com/wieslawsoltes/SharpForge/issues/1607) | View owner: `view/bidi.js`, browser caret/range geometry | Outside this branch's DOM assignment. Logical Unicode boundaries are covered here; actual bidi visual movement must use the view/browser evidence. |
| SF-A20-T04.5 / [#1608](https://github.com/wieslawsoltes/SharpForge/issues/1608) | `packages/text/src/columns.js`, `visual-column-index.js`, `visual-columns/*`, `EditorModel`; `65da4467`, `de8eeff3`, `e688ce9c`, `e43c811e` | Exact async and cached columns cover every UTF-16 seam, tabs/widths, a 200MiB line, multi-MiB combining clusters, edit-prefix reuse, undo/rollback, cancellation/disposal and cache bounds. Shell StatusPosition consumes this model seam; rendered Col/Ch remains shell/browser evidence. |

The default grapheme service now uses complete pinned Unicode 16.0 extended
grapheme data and a constant-space streaming state. The earlier approximate
fallback limitation is superseded by all 1,093 official conformance rows. An
explicitly injected Intl segmenter remains supported; existing editor fixtures
match the actual Unicode17 host. The full native Unicode16 oracle is skipped
on this host because its ICU data has a different version. Rectangular edits keep wide graphemes indivisible if
only part of their display width intersects the rectangle. Box insertion is
bounded before allocation/mutation, including padding on newly pasted rows.

## Bounded search, replacement, diff and merge

| Work ID / issue | Implementation | Evidence and acceptance boundary |
| --- | --- | --- |
| SF-A20-T39 / [#1508](https://github.com/wieslawsoltes/SharpForge/issues/1508) | `packages/text/src/search/{parser,predicates,compiler,interpreter,literal,find,errors}.js`; `ad3349e6`, `cf83ac21`, `f685f0a1` | Regex oracle, multiline, Unicode, captures/names, lookaround, empty matches, cancellation, invalid patterns and hard pathological termination in `tests/text-search-regex.test.js`. Untrusted patterns run in the bounded VM, never native backtracking regex followed by an elapsed-time check. |
| SF-A20-B03 / [#1481](https://github.com/wieslawsoltes/SharpForge/issues/1481) | `packages/text/src/search.js`, `search/replacement.js`; `cf83ac21`, `f685f0a1` | Public `findTextMatches`, `expandReplacement`, `replaceTextMatches` retain UTF-16 match spans and capture replacements. Find widgets, project Find in Files and cooperative browser/worker scheduling are separately owned by insight/workspace integration. |
| SF-A20-T10.1 / [#1632](https://github.com/wieslawsoltes/SharpForge/issues/1632) | `packages/text/src/diff.js`, `diff/{tokenize,myers,budget}.js`; `4630757a` | Line/word/character edits, exact CRLF/UTF-16 hunks, 3,000 minimum-oracle scripts, cancellation and bounded exact-replacement fallback. `minimal`, `timedOut` and `truncated` identify fallback honestly. |
| SF-A20-T10.2 / [#1633](https://github.com/wieslawsoltes/SharpForge/issues/1633) | Insight owner: `packages/editor/src/diff` side-by-side view | Uses the algorithms above. Row alignment, scrolling and widgets use insight/browser evidence. |
| SF-A20-T10.3 / [#1634](https://github.com/wieslawsoltes/SharpForge/issues/1634) | Insight owner: inline diff view | Data spans are qualified here; rendered inline hunks and navigation are insight-owned. |
| SF-A20-T10.4 / [#1635](https://github.com/wieslawsoltes/SharpForge/issues/1635) | `packages/text/src/merge3.js`; `4630757a` | Stable conflict identifiers, independent/identical edit merging, and exact base/ours/theirs/result conflict spans including dominant-EOL markers. |
| SF-A20-T10.5 / [#1636](https://github.com/wieslawsoltes/SharpForge/issues/1636) | Insight owner: merge editor actions | Resolving base/ours/theirs/both in the actual result editor is covered by the insight integration suite. |

Search defaults to a two-million-step/25 ms cooperative budget, with explicit
larger limits up to one billion VM/KMP steps for trusted worker or benchmark
callers. Stack, parser depth, instruction count, capture count and pattern length
are also bounded. Unsupported variable-width lookbehind and unknown escapes
produce `SearchPatternError`; exhaustion produces `SearchLimitError` with a
reason and step count. This is a documented bounded regex language, not complete
ECMAScript or native Vim regex parity. Scalar escapes such as `\u{1F600}` are
qualified; paired UTF-16 surrogate escape spelling is not a parity claim.

Diff limits bound tokenization/search/refinement and provide a truthful exact
replacement fallback. Final merge assembly, hashing and editor rendering are
separate costs; a diff deadline is not an end-to-end merge-view latency promise.

## Named commands and profile behavior

| Work ID / issue | Implementation | Evidence and acceptance boundary |
| --- | --- | --- |
| SF-A20-B01 / [#1479](https://github.com/wieslawsoltes/SharpForge/issues/1479) | Visual Studio binding and named feature route; `5d4b79f2` regression | `tests/a20-surround-with-shortcut.test.js`: Ctrl+K waits; Ctrl+S calls Surround With once; production SnippetSession edits the actual model with one undo. Code actions and host requests stay at zero. Missing provider reports a clear message and leaves text/history unchanged. Picker rendering and real browser delivery remain separate qualification. |
| SF-A20-T07.1 / [#1619](https://github.com/wieslawsoltes/SharpForge/issues/1619) | `packages/editor/src/commands/{context,index,editing,movement,extended,outlining}.js`; root `69dd1751`, qualification `db9add16` | `a20-07-keybindings`: registered vocabulary, actual movement/edit/selection/fold results, read-only gates, aliases and no whole-document mirror. Feature-provider calls are tested at their explicit host seam. |
| SF-A20-T07.2 / [#1620](https://github.com/wieslawsoltes/SharpForge/issues/1620) | `keymaps/visual-studio.js`, `docs/vs-inventory.json`; root `c4a4e52a` | Binding inventory, known unbound/compatibility choices and named-command coverage. Inventory is pinned; desktop Visual Studio key delivery was not run. |
| SF-A20-T07.3 / [#1621](https://github.com/wieslawsoltes/SharpForge/issues/1621) | `keymaps/platform.js`; `8002b6fa`, `db9add16`, `7870600d` | macOS Meta versus physical Ctrl; browser alternatives; IME/AltGraph/dead-key exclusions; observed shifted brackets/slashes/digits and preservation of other-layout logical keys. Synthetic events are not OS interception evidence. |
| SF-A20-T07.4 / [#1622](https://github.com/wieslawsoltes/SharpForge/issues/1622) | `keymaps/{resolve,conflicts,when}.js`; `2777f2e7`, `db9add16`, `2b835790` | Exact/prefix conflicts, scope/priority/context precedence, timeout/Escape/disposal and atomic binding-table replacement. Disposable filters remove specific assignments without swallowing sibling chords. Public record/normalization utilities feed shell Options. |
| SF-A20-T09.1 / [#1627](https://github.com/wieslawsoltes/SharpForge/issues/1627) | Shared command registry plus profile tables; `90639390`, `db9add16` | Every emitted profile command is registered or deliberately routed to an explicit view/provider contract. |
| SF-A20-T09.2 / [#1628](https://github.com/wieslawsoltes/SharpForge/issues/1628) | `keymaps/vscode.js`, `tests/support/vscode-behavior-fixtures.js` | 99 distinct shortcut cases use actual buffer, carets, undo, bookmarks/folds and command results, exceeding the required 60 fixtures. |
| SF-A20-T09.3 / [#1629](https://github.com/wieslawsoltes/SharpForge/issues/1629) | `keymaps/emacs.js`, `kill-ring.js`; `90639390`, `10e59764` | Mark/region extension/exchange, bounded ring, append/prepend kills, yank/yank-pop, C-x chord precedence and chain cancellation by unrelated commands. |
| SF-A20-T09.4 / [#1630](https://github.com/wieslawsoltes/SharpForge/issues/1630) | `keymaps/sublime.js` and shared native multi-caret services | Actual occurrence selections and multi-caret changes/undo are checked; no mirrored CodeMirror buffer supplies the result. |
| SF-A20-T09.5 / [#1631](https://github.com/wieslawsoltes/SharpForge/issues/1631) | `keymaps/native.js`; `909796e3`, `10e59764`, `de8eeff3` | Switches preserve model identity, text, history, primary direction, folds, scroll, registers, marks and Emacs ring. Unfinished Vim insert/replace resumes in a fresh explicit group. Model swap and disposal release subscriptions. |
| SF-A19-T32 / [#1468](https://github.com/wieslawsoltes/SharpForge/issues/1468) | `apps/studio/workbench/studio-keyboard.js`; `056b2147` | Ten `a19-studio-keyboard` cases cover atomic profile/assignment/removal preflight, custom execution once, removed native/global chord precedence, persistent registrations, conflict data, window/dialog routes and disposal. Options form/persistence/export presentation is shell-owned. |

StudioKeyboard installs a native filter through the public resolver seam. It does
not capture a removed chord's whole prefix. Profiles and removals are validated
before replacing live tables, per-window global dispatch is installed/disposed
with the document, and no-active-editor routing cannot recurse through a native
command alias. The final package entry exports `eventStroke`, `normalizeStroke`
and `normalizeSequence` for the Options recorder; foreign-package deep imports
are unnecessary.

## Vim contract and remaining targets

| Work ID / issue | Implementation | Evidence and acceptance boundary |
| --- | --- | --- |
| SF-A20-T08.1 / [#1623](https://github.com/wieslawsoltes/SharpForge/issues/1623) | `tests/editor-vim.test.js`, `tests/a20-vim-blocks.test.js`; `77ec3ffc`, `de8eeff3` | Counts, motions, operators, objects, modes, registers, marks, macros/repeat, search/substitute, malformed input, boundaries, permission failures, stale results, read-only and disposal. The eight listed unsupported targets satisfy the issue's explicit unsupported-feature reporting requirement. |
| SF-A20-T08.2 / [#1624](https://github.com/wieslawsoltes/SharpForge/issues/1624) | `keymaps/vim-registers.js`, command clipboard provider; `52c3d479`, `77ec3ffc`, `de8eeff3` | Async `+`/`*`, denied writes/reads, stale selection/profile/document checks and block-row metadata while clipboard text still matches. Actual paste into another OS application remains browser/manual qualification. |
| SF-A20-T08.3 / [#1625](https://github.com/wieslawsoltes/SharpForge/issues/1625) | `keymaps/vim-ex.js`; `b3501adc`, `77ec3ffc` | Save/all, delete/list buffers, next/previous, horizontal/vertical split, no-highlight, option subset and ranged substitution call the shared host contract. Unsupported commands/options are explicit. Creation of the real document group belongs to root/workbench integration. |
| SF-A20-T08.4 / [#1626](https://github.com/wieslawsoltes/SharpForge/issues/1626) | `keymaps/{native,native-document,buffer-adapter}.js`; `47266ba3`, `909796e3`, `10e59764` | Tests execute the native JS model projection, with operation history, live marks and savepoint identity. The compatibility constructor creates no second CodeMirror editor or document/history mirror. |

The earlier mixed-width visual-block implementation gap was **fixed** in
`de8eeff3`. Tests now cover partial tabs, wide/combining/ZWJ text, empty/short
rows, display-column motion, opposite corners, `I`, `A`, `$A`, `c`, `C`, `D`,
`r`, case aliases, counted shifts and row-aware register puts, including new
lines beyond EOF. All such changes use one production undo history. The visual
operator interpretation follows the documented
[Vim visual contract](https://vimhelp.org/visual.txt.html#blockwise-operators),
retrieved 2026-10-03; this is a specification comparison, not an executed Vim
reference run.

| Explicit skipped target | Reason / disposition |
| --- | --- |
| Shell commands and external filters | The browser editor has no shell/process-execution provider in this scope. Unknown Ex operations report an error. |
| Vimscript and plugin loading | No Vimscript interpreter or plugin runtime is part of the accepted browser adapter. |
| Terminal buffers | Terminal emulation is outside the text-document/keymap contract. |
| Native Vim-only regex extensions | Search exposes the bounded documented regex language; unsupported escapes are errors. |
| Operating-system primary selection | Injected async clipboard reads/writes ordinary clipboard text; OS primary-selection semantics are not available from that interface. |
| Unlimited recursive macros | Intentionally excluded by required input bounds: recursion depth 16, 10,000 replay keys and register-memory limits. |
| Desktop Vim executable parity | No actual Vim executable was run as an oracle. |
| Browser interception and assistive technology | Real browser/OS key delivery, clipboard grants, NVDA/VoiceOver and physical input need independent browser/manual runs. |

These are not passing tests. They do not excuse an unimplemented accepted model
operation. Full IME/bidi/UI, browser rendering latency and fixed-runner performance
qualification remain with the view/T12/root integration owners. The broader
[editor benchmark evidence](performance/editor-benchmarks.md) records real model
cold/warm samples, p50/p95/p99 and retained-memory deltas separately from the
explicitly unavailable browser measurements; Node test duration is not used as
a key-to-paint benchmark.

## First-run schemes and ReSharper-like follow-up

| Work ID / issue | Implementation | Focused evidence and boundary |
| --- | --- | --- |
| SF-A19-T42 / [#1478](https://github.com/wieslawsoltes/SharpForge/issues/1478) | Native `keymaps/resharper.js` and public profile registration; Studio `keyboard-profile.js`, `studio-keyboard.js`, `shell-commands.js`; `first-run.js`, `options-dialog.js`, `settings-profile.js`, `settings-store.js`; `c33b162a`, `79c888a6` | `tests/a20-resharper-keymap.test.js` (12 cases) and `tests/a19-first-run-schemes.test.js` (15 cases). Real model/edit/history results, provider boundaries, all distinctive gestures and explicit browser chords, Windows/Mac event normalization, read-only/IME/AltGraph/disposal, global routing without an active editor, actual search filters, profile switching, first-run, Options, import/export/reset, workspace overlays, cancellation, invalid values, quota rollback, and preserved document/undo state. Physical browser/OS/JetBrains execution is not claimed. |

The stable new identifier is `resharper`, labelled **ReSharper-like (IntelliJ)**.
The reference is the IntelliJ column of JetBrains' official ReSharper 2026.2
shortcut documentation, updated 7 August 2026, and its official reference card.
[The scheme contract and complete mapped table](a19-environment-schemes.md)
link both sources and distinguish SharpForge provider behavior from complete
JetBrains feature parity. Visual Studio remains the default. No second editor
document or history was introduced. The current shell already installs the
shared global resolver and changes all views through its existing callback.

Source, tests, and docs were committed before running this complete scope:

```sh
node scripts/limited.js node --test --test-reporter=spec \
  tests/a19-first-run-schemes.test.js tests/a20-resharper-keymap.test.js \
  tests/a19-studio-keyboard.test.js tests/a19-shell-settings.test.js
```

Node v24.19.0, Linux x64: initial result **47 passed / 1 failed**, no skips,
1.224 seconds. All **27 new cases passed**. The affected older test expected only
one default global Save binding under Emacs. Global scheme projection now also
exposes Emacs' distinct Ctrl+X, Ctrl+S chord. `3acf6974` replaces that count with
the exact expected key sequences, executes the chord once, and verifies that
removing a dynamic binding preserves both defaults. The focused rerun passed
**10/10**, no skips, 0.264 seconds:

```sh
node scripts/limited.js node --test --test-reporter=spec tests/a19-studio-keyboard.test.js
```

The complete scope therefore has **48 distinct eventual passing cases**,
including 21 existing regression cases; this was not reported as a single
48-pass invocation. No full local suite, browser run, or OS key-delivery run was
performed. Test duration is not a UI latency or JetBrains performance measure.

The editor's exported smoke and all three integration steps also ran explicitly:

```sh
node scripts/limited.js node --input-type=module -e '
import {smoke,smokeSteps} from "./packages/editor/smoke.mjs";
await smoke({api:await import("@sharpforge/editor")});
const context={};
for(const step of smokeSteps) await step.run(context);'
```

An initial direct module invocation only loaded its exports and was not counted
as smoke evidence. The first actual execution found the old expectation that
the public CSS entry itself contains `.sf-editor`; the view now composes that
entry through imports. `1911ae38` makes the smoke read every directly imported
bundled stylesheet and then require the native editor selector. Final result:
public API smoke plus **3/3 integration steps passed**, including the new six
profile inventory and retained Visual Studio default.

`git diff --check efcc20d3..HEAD` passed. The structure report still lists 242
pre-existing aggregate findings; none of this scope's new source or test files
exceeds its size/line limits. The touched legacy settings renderer retains its
structure and shrinks from 29,150 to 29,114 bytes while removing the obsolete
CodeMirror claim. Root owns final manifest registration and the integrated PR
check. Logs are `/tmp/p16-resharper-tests.log`,
`/tmp/p16-resharper-keyboard-regression.log`,
`/tmp/p16-resharper-smoke-executed.log`, and
`/tmp/p16-resharper-structure.log`.

## Commit trail and integration handoff

| Revision | Complete owned batch |
| --- | --- |
| `a3e603bd` | Indexed persistent storage, EOL metadata, versions and snapshots. |
| `96931f4f` | Operation undo, model transactions and selection normalization. |
| `65da4467` | Grapheme, word/subword and visual-column algorithms. |
| `ad3349e6`, `cf83ac21` | Bounded regex compiler/interpreter and public search/replacement. |
| `4630757a` | Bounded line/word/character diff and three-way merge model. |
| `68885522` | Multi-caret, rectangular selection and clipboard transactions. |
| `f685f0a1`, `e87dedf4` | Boundary corrections, complete foundation tests/docs and measured scale evidence. |
| `9c9a5248` | Explicit nested history groups and saved-state identity. |
| `db9add16`, `10e59764`, `77ec3ffc` | Native named-command, profile and Vim behavioral qualification/corrections. |
| `2b835790`, `056b2147` | Public shortcut recording/filter seam and atomic Studio keyboard routing. |
| `7870600d` | Observed shifted digit normalization with other-layout preservation. |
| `de8eeff3` | Complete visual-block geometry/edit/register follow-up, bounded box payloads and resumed insert groups. |
| `e688ce9c`, `e43c811e` | Exact sparse visual-column index, Unicode16 data/state, stable model cancellation/disposal, official and host compatibility cases. |
| `5d4b79f2` | Exact B01 Surround With shortcut, one-undo snippet result and absent-provider regressions. |
| `fe2c20f7` | Captured large-source native Save As, explicit download exports, complete focused I/O/encoding/scale tests and contract. |
| `c33b162a`, `79c888a6` | Native ReSharper-like profile, global scheme projection, first-run/Options/import/reset and complete focused fixtures/docs. |
| `3acf6974`, `1911ae38` | Exact projected Emacs save/disposal regression and modular installed-stylesheet smoke correction. |

Root-provided initial native source ends at `909796e3`. This branch also merged
the view facade correction `ccdd6894`, root dependency merge `447a2325`, and the
explicit `EditorViewModel`/disk boundary tip `4b27d69e` where needed. Shared-model read-only enforcement
`ca0a52fc` was merged before the visual-column follow-up and is exercised by its
model cases. It remains absent from the earlier observed `de8eeff3` result.

No remote branch was pushed, rebased, force-updated, or published by this agent.
The unexpected untracked compiler differential `baseline.json` was left alone.
Root must register the new test paths and verify the final integrated public
entry/build before asserting a passing required PR check.
