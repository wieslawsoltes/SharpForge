# Change-tracking deletion bookkeeping — SF-A20-T12 / SF-A20-T35

The a6 browser comparison at `25ef23b0fb86eb3be4151492c2ef6bbc51f0a82e`
retains three failed relative undo-to-paint rows against the pinned a5 source
`c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`: 1 MiB p95 36.5 → 51.2 ms,
10 MiB 29.3 → 53.2 ms, and 100 MiB 41.8 → 58.7 ms. The actual browser metric,
64 KiB paste used to prepare undo, baseline, raw samples and 20% threshold are
unchanged. This source correction does not assert the cause of those tail changes
or a measured speedup.

Read-only investigation found a pre-existing bookkeeping defect on that real undo
path. `ChangeTracking.applyChange` shifted trailing touched lines but retained
every touched line inside a deleted range. Undoing the benchmark's 64 KiB paste
(2,621 newlines) therefore left 2,622 touched-line candidates after restoring the
source. The overview ruler visits every candidate and compares its current,
saved and opened line on subsequent renders. Removed candidates could also
survive beyond EOF. The defect exists in both a5 and a6; its presence does not
establish a cause for the observed difference between those runs.

The correction drops candidates covered by each replaced old line range, shifts
only surviving candidates after that range, and adds the actual new line range.
Surviving partial start/end lines remain candidates. Mapping uses the event's
immutable `before`/`after` snapshots and precomputed `range`/`newRange`, including
cumulative positions for multi-edit transactions. It does not count newline
characters in replacement text: inserting LF after CR, deleting one half of
CRLF, or splitting/joining a delimiter can preserve or change line counts in ways
that a replacement-text count misses.

New ranges are already in final coordinates and are added only after old
candidates have been mapped. A CRLF boundary can advance the new start beyond a
surviving prefix line, so the mapped old start is retained as well. Grouped undo
uses each event's snapshots, even when its notifications arrive after the live
buffer has reached its final root. Normalized edits without precomputed ranges
still work using `before`, `after`, `start`, `end`, and `text`; their new offsets
are derived from the preceding edit lengths without materializing source text.

The public `ChangeTracking` constructor, `touched`, `stateAt`, `markSaved`, and
`hunk` contracts are unchanged. No new API, dependencies, scheduling policy,
benchmark measurement or performance threshold is introduced. The transformation
cost is O(changes log changes + touched × changes + newly touched line spans),
with indexed snapshot-position lookups only when precomputed ranges are absent.
Storage is proportional to edit spans and surviving/new candidates; it no longer
retains lines solely because an earlier paste once created them.

`tests/a20-change-tracking-deletions.test.js` authors 16 focused cases, including:

- The exact 64 KiB paste on a 1 MiB model, undo, and production overview marker
  collection through an explicit read-counting model adapter. The expected restored
  state has one conservative line candidate and one current/two snapshot line reads,
  rather than 2,622 candidates. This is a work-count assertion, not a timing claim.
- Repeated undo/redo cycles, unaffected surrounding markers, partial multiline
  replacement, line-start/EOF boundaries and whole-document deletion.
- LF, CRLF and CR sources; LF-only CRLF deletion; CR/LF pairing and splitting.
- Reverse-ordered edits, adjacent endpoints on one old line, cumulative line shifts,
  grouped undo, saved/unsaved transitions, and hunk reverts.
- Before/after snapshot fallback when precomputed range metadata is omitted.

At source handoff these tests are unexecuted. Root owns the bounded old-source
failing reproduction, then the complete affected-source cohort at the committed
correction. The initial a6 failures remain evidence, and subsequent browser
qualification must report the unchanged metric honestly.
