# Project 16 a5 correction: local qualification

The completed A19 and A20 runs retained four failed fixture assertions. After correcting those assertions and their setup,
the three affected files passed all 21 cases. The original area results remain failed; this is not a whole-area rerun or a
combined distinct-test total. No product code changed between the full-area source and the retry source.

| Recorded run | Tests | Passed | Failed | Skipped | Runner duration |
|---|---:|---:|---:|---:|---:|
| Full A19 | 790 | 787 | 3 | 0 | 52.500854497 s |
| Full A20 | 722 | 712 | 1 | 9 | 39.960535170 s |
| Three affected files | 21 | 21 | 0 | 0 | 7.228429758 s |

All three runs recorded zero cancelled and zero todo cases. The retry overlaps the original area runs and adds no claimed
unique-test count. The nine A20 skips retain their exact names and reasons in the JSON report, including browser/assistive
qualification, desktop Vim reference, capability limits, and the pinned native Unicode 16.0 comparison.

## Exact sources and execution records

The full-area source was local commit `cae69484b1ece1991e99b39a61a77303d96fca39`, tree
`bbad9762d256d60d74e5b4cadbc6344d2e969cad`. The publication map records corresponding public commit
`c0308e3cb3a4715da63dfcaa61aaa509a9459cac`; the retained logs identify the local commit, not a hosted execution.
The recorded runtime was Node `v24.19.0`.

| Run | Exact command | Start (UTC) | Finish (UTC) | Exit |
|---|---|---|---|---:|
| A19 | `node scripts/planning/run-tests.js --area A19` | 2026-10-04T05:44:36.577583+00:00 | 2026-10-04T05:45:29.480796+00:00 | 1 |
| A20 | `node scripts/planning/run-tests.js --area A20` | 2026-10-04T05:45:29.482757+00:00 | 2026-10-04T05:46:09.719251+00:00 | 1 |

The affected retry used local commit `da51eb7ddb96a5e6aa5c1a05b2158a71791340d5`, tree
`1bfd356682fb507e0f4ac365b3a4e16794a1e140`. That commit was not yet published at this archive cutoff.
It ran from `2026-10-04T05:50:14.329655+00:00` to `2026-10-04T05:50:21.736814+00:00`, with exit code 0:

```sh
node scripts/limited.js node --test tests/a19-studio-composition.test.js tests/a19-studio-runtime-timers.test.js tests/a20-studio-streamed-workspace.test.js
```

Both capture summaries record `sourceUnchanged: true`. Runner durations above are the recorded Node values, not the
start-to-finish wall-clock intervals. Commands and timestamps are preserved verbatim in the raw summary files.

## Four failures and the affected retry

| Original failure | Correction | Retry |
|---|---|---|
| A19 silent large-document build expected the old automatic-build status | `3389ec15`: assert the exact compiler eligibility diagnostic and owning project; retain no worker requests | Passed |
| A20 actual 200 MiB ingress expected the old large-file status | `3389ec15`: assert the exact compiler eligibility diagnostic and workspace project; retain bounded ingress/no worker requests | Passed |
| Source VM background stop/restart expected Beta without selecting it | `dab4d0e7`: select Beta explicitly before stopping background Alpha; retain isolation checks | Passed |
| Direct CIL background stop/restart had the same setup error | `dab4d0e7`: apply the same explicit selection setup and debugger identity assertions | Passed |

The corrections were integrated by `3f3916249d53953f04830aacd4919213a6295825` and
`da51eb7ddb96a5e6aa5c1a05b2158a71791340d5`. The source comparison changes only three test files and two documentation
files. The retry runs all three affected files and covers every original failure; it does not turn the retained full-area
executions into passing runs.

## Retained evidence and limits

The [machine-readable report](project16-a5-correction-local-qualification.json) retains exact counts, source identities,
commands, timestamps, failure coverage and skip reasons. Five raw files, totaling **165,461 bytes**, are copied without
modification and listed with byte counts and SHA-256 hashes in the
[archive manifest](evidence/project16-a5-corrections-local/manifest.json):

- Full-area [A19 log](evidence/project16-a5-corrections-local/full-areas/A19.log),
  [A20 log](evidence/project16-a5-corrections-local/full-areas/A20.log), and
  [capture summary](evidence/project16-a5-corrections-local/full-areas/node-summary.json).
- Affected [retry log](evidence/project16-a5-corrections-local/affected-retry/affected.log) and
  [capture summary](evidence/project16-a5-corrections-local/affected-retry/node-summary.json).

Local structure inspection, Python contracts and performance evidence for this correction cohort are separate and pending
at this cutoff. These Node results do not establish a corrected hosted browser or standalone workflow pass, a new
application build, native/platform acceptance, or a full-area pass at the retry revision. Earlier evidence is unchanged.
Archiving copied and hashed existing records; it executed no tests, builds, captures, benchmarks or static gates.
