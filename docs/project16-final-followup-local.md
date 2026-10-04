# Project16 final follow-up — local reproduction and affected cohort

The completed local follow-up passed **69/69 Node cases**, with no failures or
skips, at source `20474bfed2c3c442ae50ae46d2dbcff02f155bc5`. The preceding run
of the exact new change-tracking tests against unchanged old source produced
**9 passes and 7 failures out of 16**, establishing the bookkeeping and CRLF
defects before the correction. Both executions are retained separately; their
overlapping counts must not be added.

This evidence covers SF-A20-T12 / SF-A20-T35 change-tracking deletion geometry
and SF-A19-T12.1 / SF-A19-T38 standalone qualification selection. It records local
functional tests only. It does not establish a browser paint-time improvement,
a successful standalone browser launch, hosted CI success or native qualification.

| Execution | Source commit | Source tree | Result | Node test duration |
| --- | --- | --- | --- | --- |
| Expected failing old-source proof | `25ef23b0fb86eb3be4151492c2ef6bbc51f0a82e` | `a0922a5f98e4ce38cd377d109a083a1da77df9a1` | 16 total, 9 passed, 7 failed, 0 skipped; exit 1 | 385.244127 ms |
| Complete affected cohort | `20474bfed2c3c442ae50ae46d2dbcff02f155bc5` | `5c5d290f9c190cd4e5c1b5d8e7124f9c0980ec4a` | 69 total, 69 passed, 0 failed, 0 skipped; exit 0 | 1396.190192 ms |

Both runs used Node `v24.19.0` through `node scripts/limited.js node --test
--test-reporter=tap`. The old-source execution ran from
`2026-10-04T07:18:55.436535+00:00` to `2026-10-04T07:18:55.955509+00:00`;
the affected cohort ran from `2026-10-04T07:23:45.467443+00:00` to
`2026-10-04T07:23:46.986351+00:00`. These timestamps describe the invocation
window; the table preserves the test runner's separately reported duration.

The exact candidate test was copied temporarily onto the unchanged old source:
`tests/a20-change-tracking-deletions.test.js` from
`e8f27e7984503f90c1f4a0b78928d891889f0103`, SHA-256
`17e1b3ccc620a0721534f567620d17cea5f0e1867de60466dc2cf37e7f33200f`.
Root verified and removed only that authored untracked copy before merging;
unrelated untracked files were preserved. Both original summaries record
unchanged source, clean tracked state after execution, observed untracked files
and actual editor/text/syntax package resolution in the integration worktree.

The seven old-source failures were:

- The exact 64 KiB paste/undo restored-candidate and overview source-read bound.
- Repeated paste, undo and redo without obsolete marker accumulation.
- Deletion ending at a line start with a surviving old-end marker.
- Deletion through EOF and whole-document replacement.
- LF-only deletion within CRLF, preserving prefix, suffix and trailing markers.
- LF insertion after CR without incorrectly shifting trailing markers.
- Splitting and rejoining CRLF using exact snapshot geometry.

The correction was committed as `e8f27e7984503f90c1f4a0b78928d891889f0103`
and integrated by `f90dcf4e83665f18d953a3268d1d5d611bdf745f`.
Standalone selection source `19f027ec068434825f16d6edd253a23af4d27b4d` was
then merged as the tested combined source
`20474bfed2c3c442ae50ae46d2dbcff02f155bc5`. These are exact local Git
identities; this archive does not assert a new published-commit mapping.

The complete seven-file cohort contains the same 16 change-tracking cases,
five new standalone-selection cases and 48 existing regression cases:

1. `tests/a20-change-tracking-deletions.test.js`
2. `tests/a20-view-editing-options.test.js`
3. `tests/a20-model-preview-publication.test.js`
4. `tests/a19-qualification-standalone.test.js`
5. `tests/a19-qualification-outcomes.test.js`
6. `tests/a19-qualification-trigger.test.js`
7. `tests/a19-qualification-profiles.test.js`

All 16 change-tracking cases passed in that cohort, including all seven
old-source failures. The overview assertion uses production `ChangeTracking`
and `OverviewRuler` with a DOM construction double and explicit source-read
counting. It verifies bounded work after undo, not frame timing. The five
standalone cases verify selection and orchestration; they do not launch a GUI.

The [machine-readable manifest](evidence/project16-final-followup-local/manifest.json)
contains exact commands, commit/tree pairs, test-file SHA-256 identities, failure
names, timestamps, counts and hashes of every archived raw file.

| Raw artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [Old-source TAP log](evidence/project16-final-followup-local/baseline/tests.log) | 155997 | `94a61d43bfed0e35a5b75885bfb2069d29595b8120e703f0cfcd374c72963a39` |
| [Old-source summary](evidence/project16-final-followup-local/baseline/summary.json) | 2018 | `4e2858e86b1f9832245b8046d0970300301fd8984c532a87e44a1d31d580f5d2` |
| [Affected-cohort TAP log](evidence/project16-final-followup-local/targeted/tests.log) | 16940 | `4510c1cfa60ad3a05a890d252ce6f0ff438406b2563e6db6ce418fcf886ed949` |
| [Affected-cohort summary](evidence/project16-final-followup-local/targeted/summary.json) | 3198 | `03e2433d4d53f76b19c122543722136d4378950c978585c55d920c73fe03c4f5` |

The raw files are byte-for-byte copies of the root-produced execution artifacts.
No tests, builds, checks or benchmarks were run to assemble this documentation.
The 69-case result must not be added to the 16-case reproduction or to previous
full-area or hosted a6 totals. The original a6 relative undo-to-paint failures
remain in the evidence: this pre-existing defect occurred in both compared
sources, and these functional results neither establish its role in the observed
latency difference nor waive the unchanged 20% performance threshold.
