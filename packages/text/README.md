# @sharpforge/text

Dependency-free text infrastructure for SharpForge compilers, editors, search services, and review tools. Public positions and edit ranges use **UTF-16 code units**; lines and characters are zero based.

## Persistent editing

```js
import { TextBuffer } from '@sharpforge/text';

const buffer = new TextBuffer('one\r\ntwo\r\n', { uri: 'Program.cs' });
const original = buffer.snapshot();
const unsubscribe = buffer.onDidChange(change => {
  console.log(change.oldVersion, change.version, change.changes);
});
buffer.applyEdits([
  { start: 0, end: 3, text: 'ONE' },
  { start: 5, deleteCount: 3, text: 'TWO' }
]);
console.log(original.getLine(0)); // one: the old snapshot remains unchanged
console.log(buffer.getLine(0));  // ONE
unsubscribe();
```

`PieceTable` stores immutable original/add strings behind a persistent AVL piece tree. Every node summarizes subtree length, line breaks, and CR/LF/CRLF counts. Splits and concatenations copy the search path; unchanged nodes and original/add storage are shared. CRLF pairs spanning distinct pieces count as one logical break.

| Operation | Complexity | Allocation |
| --- | --- | --- |
| `snapshot()` | O(1) | Shared immutable snapshot |
| Insert/delete | O(log P + I + log L) | O(log P) nodes plus inserted string/index |
| `getText(start,end)` | O(log P + V + R) | Requested range only |
| `positionAt` / `offsetAt` / line start/end | O(log P + log L) | Small position object |
| `length` / `lineCount` / EOL metadata | O(1) | Small metadata object |
| Snapshot `.text` | O(document length) on first request | Complete string, cached explicitly |
| Snapshot `.lineStarts` | O(number of lines × indexed lookup) on first request | Compatibility array, cached explicitly |

`P` is piece count, `I` inserted UTF-16 units, `L` line endings in the referenced immutable storage, `V` visited pieces, and `R` requested output length. Deleting a range removes its subtrees without scanning deleted characters; `TextBuffer` additionally retains the removed range for inverse operations. The buffer does not construct a global line-start array on keystrokes.

### Buffer and snapshot contract

- `new TextBuffer(text, {uri,version,encoding,bom,maxEdits})` owns mutable document state. Defaults are version 1, UTF-8, no BOM, and at most 100,000 edits per transaction.
- `getText(start=0,end=length)` rejects invalid ranges. `substring(start,end)` follows JavaScript substring clamping and swapping semantics.
- `getLine(line)` excludes terminators; `getLine(line,{includeEol:true})` includes them. `lineStart`/`getLineStart` and `lineEnd`/`getLineEnd` return offsets.
- `applyEdits([{start,end,text}], options)` accepts original-document coordinates, also accepts `deleteCount`, rejects overlap, and commits all edits in one version. It returns `{before,after,oldVersion,version,changes,inverseEdits,source}`.
- Every change includes old `range`, `newRange`, `newStart`, and `newEnd`. Inverse edits use final-document coordinates.
- `snapshot()` returns an immutable SourceText-compatible object with `.uri`, `.version`, `.length`, lazy `.text`/`.lineStarts`, coordinate conversion, and persistent `.withChange(...)`.
- `SourceText` retains its existing constructor, fields, and compiler-facing behavior. Existing compiler clients require no migration.
- `prepareEdits` performs validation and constructs the next tree without mutation. `commitPrepared(prepared,{notify:false})` lets a workspace commit prepared participants before invoking callbacks. `emitChange` publishes a committed event. A stale preparation throws `TextVersionError`.
- `checkpoint`/`restoreCheckpoint` support invisible rollback while a workspace owns the commit barrier. They are not user undo commands.
- `dispose()` removes listeners and rejects subsequent mutation.

All synchronous notification callbacks run after the state commit. A callback exception propagates to its caller; it does not undo the committed text. Workspace owners must finish their no-notification commit phase before publishing callbacks.

### File fidelity

`metadata` reports dominant EOL, mixed endings, exact counts, final newline, encoding, and BOM. Insertion does not silently normalize input. A typing adapter can pass `{normalizeLineEndings:true}` to use `preferredEol`, which is captured from the opening document. `convertEol(eol)` emits terminator-only edits.

`decodeText(Uint8Array)` detects UTF-8/UTF-16 byte-order marks and returns document text plus encoding metadata. `encodeText(text,{encoding,bom})` supports UTF-8, UTF-16LE and UTF-16BE and rejects unsupported output encodings. Original encoding metadata remains explicit; saving never silently changes it. Text itself retains UTF-16 code units, including unpaired surrogates. UTF-8 encoding follows the platform `TextEncoder` replacement behavior for malformed surrogate sequences; UTF-16 output preserves them exactly.

## Unicode navigation and columns

```js
import { GraphemeSegmenter, nextGraphemeOffset, visualColumnAt } from '@sharpforge/text';

const segmenter = new GraphemeSegmenter(); // reuse per editor/view
nextGraphemeOffset('👩‍👩‍👧‍👦x', 0, { segmenter });
visualColumnAt('a\t界😀', 5, { tabSize: 4 });
```

`iterateGraphemes`, `graphemeSegments`, `nextGraphemeOffset`, and `previousGraphemeOffset` use a pinned Unicode 16.0 extended-grapheme profile. The default and legacy `{forceFallback:true}` path share the same complete rule/data implementation. An explicit `new GraphemeSegmenter({segmenter:new Intl.Segmenter("und",{granularity:"grapheme"})})` retains host-tailored behavior. The exported `unicodeGraphemeVersion` identifies the pinned profile; [data, license, regeneration and conformance evidence](reference/unicode-16.0.0/README.md) document the compatibility change.

`wordSegments`/`wordRangeAt` use word segmentation; next/previous word commands consume following/preceding whitespace in the usual editor style. `subwordBoundaries` separates camel/Pascal humps, acronyms, digits, underscores, and CJK characters. Pass `{subword:true}` to next/previous movement.

`graphemeWidth`, `visualColumnAt`, `offsetAtVisualColumn`, and `expandTabs` share a monospace column model. Tabs advance to explicit tab stops, East Asian wide characters and emoji occupy two cells, and combining-only/format/control clusters occupy zero. `offsetAtVisualColumn` returns logical offset, resolved column, virtual spaces, and partial-tab details. Offsets remain UTF-16 while displayed columns count visual cells. Ambiguous-width characters default to one cell. Browser bidi run ordering and pixel geometry belong to the editor's native layout integration; see [Unicode UAX #9](https://www.unicode.org/reports/tr9/).

### Indexed visual columns for large lines

`new VisualColumnIndex(buffer,options)` accepts a source with immutable indexed snapshots and an optional `onDidChange` subscription. `await index.get(offset,{tabSize,ambiguousWidth,signal})` resolves an exact zero-based column. `index.getCached(...)` returns an exact number or `null` when asynchronous indexing is needed. UTF-16 offsets inside a grapheme map to that cluster's starting column; offsets in a line terminator map to the line-end column.

Initial work is linear in the unindexed prefix and uses bounded chunks. Cached requests binary-search sparse checkpoints and read at most one configured chunk synchronously; more distant requests yield while scanning. Checkpoints retain constant-size Unicode state, so even a multi-megabyte combining cluster needs no growing overlap string. The index never requests `snapshot.text`, `lineStarts`, or a complete line. Edits preserve unaffected indexes and rewind affected prefixes before a possible UTF-16 pair seam. Cancellation, stale snapshots, disposal and capacity failures reject explicitly.

Defaults: 4,096-unit chunks, 8,192-unit checkpoints, 32 line/style entries, 32,768 checkpoints in total, 256 recent results per entry and 64 pending requests. Checkpoint spacing coarsens within the fixed cache budget. Scheduling yields after 65,536 units or an 8 ms slice; these are cooperative scheduling targets, not a browser frame-latency guarantee. `statistics` exposes actual work and cache sizes. `dispose()` releases subscriptions, rejects pending requests and clears caches. See the [model integration contract](../editor/docs/model.md#exact-visual-status-columns) and `bench/visual-columns.js` for usage and measured comparisons.

## Bounded search and replacement

```js
import { findTextMatches, replaceTextMatches } from '@sharpforge/text';

const result = findTextMatches(documents, '(?<name>\\w+):(\\d+)', {
  regex: true, multiline: true, matchCase: true,
  maxMatches: 2000, maxSteps: 2_000_000, timeLimitMs: 25, signal
});
const changed = replaceTextMatches('item:12', '(\\w+):(\\d+)', '$1 = $2', { regex: true });
```

Literal mode remains the default and uses linear KMP search. Regex mode parses supplied patterns into bytecode and executes them in an explicitly bounded interpreter. No user pattern is passed to a native backtracking regex engine. Each instruction, backreference comparison and lookaround shares one step/deadline/cancellation budget. Native regex use is confined to fixed character/property predicates with no repetitions or alternations.

Supported regex features include literals and Unicode scalar escapes, classes/ranges and Unicode properties, alternation, capturing/named/noncapturing groups, greedy/lazy bounded or unbounded repetition, anchors, word boundaries, backreferences, lookahead, and fixed-scalar-length lookbehind. Unsupported extensions and variable-length lookbehind report `SearchPatternError` with a precise `.position` and stable code; they are never silently interpreted as literals.

Defaults and hard guards:

| Guard | Default |
| --- | --- |
| Pattern length | 1,024 UTF-16 units |
| Matches | 2,000; caller may request at most 10,000 |
| Interpreter work | 2,000,000 steps |
| Deadline | 25 ms, checked inside interpreter execution |
| Backtracking stack | 20,000 states |
| Compiled bytecode | 16,384 instructions |
| Nested groups/assertions | 64 |
| Captures | 128 |
| Result text | 16,000,000 UTF-16 units |

`SearchLimitError` identifies step, time, stack, or result-size limits. An aborted signal throws `AbortError`. These bounds stop pathological expressions such as `(a+)+$` during execution. Native single-character/property predicate work is constant in input length. For broad workspace scans, dispatch calls to an explicitly owned worker so sequential document work does not block the view.

Matches retain the existing URI/span/version/line/character/preview fields and add matched `.text`, `.captures`, named `.groups`, and capture `.indices`. `expandReplacement(replacement,match,sourceText?)` supports `$$`, `$&`, `$1`–`$99`, `$<name>`, and prefix/suffix tokens when the source is supplied. Literal replacements remain literal. `replaceTextMatches` preflights match count and output limits and returns `{text,count,matches,edits}`.

### Navigation from a caret

```js
import { findLiteralMatch, findLiteralMatchAsync } from '@sharpforge/text';

const next = findLiteralMatch(buffer.snapshot(), 'selected text', {
  origin: selection.end, direction: 1, matchCase: true,
  excludeRanges: selections.map(({start, end}) => ({start, end}))
});
const previous = await findLiteralMatchAsync(buffer, 'needle', {
  origin: caret, direction: -1, signal
});
```

Both functions return `{match,wrapped}`. A match contains `{uri,version,start,end,text}`;
an exhausted scope returns `{match:null,wrapped:false}`. Forward navigation selects
the nearest match starting at or after `origin`; reverse navigation selects the
nearest match ending at or before it. The default origin is the start or end of
the document for the requested direction. Offsets are UTF-16, scalar boundaries
remain intact, and overlapping matches are eligible. A successful second pass
reports `wrapped:true`; `wrap:false` disables that pass. A match crossing the
origin remains eligible on the wrapped pass.

Navigation reads indexed snapshots in bounded chunks and retains one match.
It does not scan a document prefix to calculate line numbers or collect a capped
result page. `findTextMatches` retains its separate 10,000-result ceiling and
nonoverlap semantics. Sources may be strings, `SourceText`, immutable indexed
snapshots, or mutable buffers/models exposing `snapshot()`, captured once before
searching. A custom indexed source must provide stable `length` and
`getText(start,end)` values for the lifetime of the call. Snapshot `.text` and
`.lineStarts` are never requested when indexed reads are available.

The same simple case folding, whole-word checks and 1,024-unit query limit apply.
`excludeRanges` accepts at most 10,000 UTF-16 ranges, sorted and merged for binary
lookup; a match overlapping a range or strictly containing an empty caret is
excluded. Work is linear in visited scalars, plus logarithmic exclusion lookup
per candidate. Retained state is bounded by chunk size, query length and the
exclusion count, independently of the number of matches before the origin.

Synchronous defaults remain 2,000,000 steps and 25 ms. The asynchronous API
defaults to at most 1,000,000,000 steps and 30,000 ms for the complete search,
yields between chunks, and closes its owned message channel on completion or
failure. Both accept explicit `maxSteps`, `timeLimitMs`, `clock` and `signal`;
limit exhaustion throws `SearchLimitError`, while cancellation throws
`AbortError`, rather than returning a partial match or an incorrect wrap.
`chunkSize` defaults to 16,384 UTF-16 units and accepts 256–262,144; a surrogate
boundary may require one additional unit. An optional asynchronous
`yieldControl()` supplies an explicit host scheduler, which must resolve its
scheduling turn; cancellation and deadlines are checked before work resumes.
These are work and memory bounds, not a browser frame-time guarantee.

## Diff and merge

`diffLines`, `diffWords`, and `diffCharacters` return `{changes,hunks,minimal,timedOut,truncated,reason?}`. Changes are `{oldStart,oldEnd,newStart,newEnd}` UTF-16 intervals. Line hunks additionally expose zero-based exclusive `oldStartLine`/`oldEndLine`, `newStartLine`/`newEndLine`, and optional `innerChanges`.

The core computes Myers' shortest edit script with bounded trace memory. Character refinement preserves Unicode scalar boundaries. Whitespace modes are exact (default), `trim`, and `all`. Tokenization, path search, and refinement share a cancellable budget. When an input/token/edit-distance/time/work/trace bound is reached, the result explicitly reports `minimal:false,truncated:true` and supplies an exact whole-region replacement; a fallback never pretends to be minimal.

`merge3(base,ours,theirs,options)` auto-merges disjoint and identical changes. Conflicts contain stable IDs and exact base/ours/theirs/result spans with verbatim branch payloads. Default conflict markers preserve the base's dominant EOL. Default merge granularity is lines; `{granularity:'character'}` can merge independent changes within one line. A bounded-diff fallback remains visible through the merge's `truncated`/`timedOut` flags, allowing a review surface to request a broader worker budget.

## Verification and benchmark

```sh
node --test tests/text-buffer.test.js tests/text-search-regex.test.js tests/text-unicode.test.js tests/text-diff-merge.test.js
node --test tests/editor-model-selections.test.js
node packages/text/bench/buffer.js
```

The focused suite uses 100,000 deterministic string-oracle edits, a 100 MB boundary slice, a million-line edit budget, safe native-regex fixtures plus a subprocess watchdog for pathological input, and dynamic-programming minimum-distance comparison for randomized Myers scripts. The benchmark reports CPU/runtime and median/p95 for the existing immutable `SourceText` edit+position path versus indexed `TextBuffer` on start/middle/end edits.
