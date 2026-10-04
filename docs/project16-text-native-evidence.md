# Project 16 text engine, native commands, and keyboard evidence

This ledger records the work owned by `codex/p16-text` and the native command
qualification delegated to it. It describes implemented source and observed
checks; it does not close issues or substitute Node fixtures for browser,
desktop-editor, operating-system, or assistive-technology qualification.

The latest source and focused-test revision is **`de8eeff3`**, with earlier text
foundation evidence at **`e87dedf4`**. Both use the production JavaScript
`TextBuffer`, `EditorModel`, selection and undo implementations. The headless
editor fixture supplies view, host-provider, and clipboard seams, and retains no
second copy of document text. Root integration owns final package/build gates,
test-manifest registration, stacked publication and the complete browser matrix.

## Observed verification

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
| SF-A20-T04.1 / [#1604](https://github.com/wieslawsoltes/SharpForge/issues/1604) | `packages/text/src/graphemes.js`, native `commands/movement.js`, `keymaps/vim-motions.js`; `65da4467`, `db9add16`, `77ec3ffc`, `de8eeff3` | Unicode and native suites cover combining marks, ZWJ families, emoji modifiers, flags, Hangul, common Indic clusters, CRLF, and non-BMP moves/deletes without surrogate splitting. |
| SF-A20-T04.2 / [#1605](https://github.com/wieslawsoltes/SharpForge/issues/1605) | `packages/text/src/words.js`; `65da4467` | Word/subword tests cover CJK, acronym/camel humps, digits and underscores. Word services are explicit/injectable. No desktop Visual Studio word-navigation oracle was executed. |
| SF-A20-T04.3 / [#1606](https://github.com/wieslawsoltes/SharpForge/issues/1606) | View owner: `view/composition.js`, `view/input.js` | Outside this branch's DOM implementation assignment. Native shortcut tests verify composition is not intercepted, which is not an IME rendering or OS-input qualification. |
| SF-A20-T04.4 / [#1607](https://github.com/wieslawsoltes/SharpForge/issues/1607) | View owner: `view/bidi.js`, browser caret/range geometry | Outside this branch's DOM assignment. Logical Unicode boundaries are covered here; actual bidi visual movement must use the view/browser evidence. |
| SF-A20-T04.5 / [#1608](https://github.com/wieslawsoltes/SharpForge/issues/1608) | `packages/text/src/columns.js`; `65da4467`; Vim integration `de8eeff3` | Tabs, wide graphemes, zero-width marks and virtual space share one column model. Native block and vertical motions prove display-column behavior. Status-bar Col/Ch presentation remains view/workbench owned. |

The default grapheme service uses `Intl.Segmenter`, whose Unicode version comes
from the host runtime. Its explicit fallback covers the documented cluster
families above; it is not advertised as a complete independently versioned
Unicode property database. Rectangular edits keep wide graphemes indivisible if
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

Root-provided initial native source ends at `909796e3`. This branch also merged
the view facade correction `ccdd6894`, root dependency merge `447a2325`, and the
explicit `EditorViewModel`/disk boundary tip `4b27d69e` where needed. Subsequent
shared-model read-only enforcement is owned by the view integration follow-up;
it is not silently included in the observed `de8eeff3` result.

No remote branch was pushed, rebased, force-updated, or published by this agent.
The unexpected untracked compiler differential `baseline.json` was left alone.
Root must register the new test paths and verify the final integrated public
entry/build before asserting a passing required PR check.
