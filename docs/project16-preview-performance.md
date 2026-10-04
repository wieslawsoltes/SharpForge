# Preview ownership: measured model cost and reviewer acceptance

The matched model comparison **fails the 5% p95 regression gate**: five of ten
rows exceed the threshold. Three rows also exceed 5% at the median. Both captures
completed successfully with every operation's correctness assertion passing.
These are separate outcomes; correctness does not turn the performance result
into a pass.

The root integration reviewer (`/root`) accepts the ownership guards for their
proven prevention of transient preview source publication, stale prepared-edit
ABA commits, and forged or repeated source-change notifications. This is an
explicit **reviewer acceptance of the recorded cost**, not user approval, a 5%
performance pass, or a claim that each observed change is caused by those guards.
Actual browser latency qualification for this candidate remains pending a5.

## Captures and identity

The retained [capture summary](evidence/project16-followup-model/summary.json)
records one baseline followed by one candidate on the same shared host, from
2026-10-04 04:49:44 to 04:49:48 UTC. Neither capture was repeated for a better result.

| Capture | Exact source revision | Source tree |
|---|---|---|
| Baseline | `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557` | `dc9d4e337b91c6e878e7c6c7d65f013667b5ec6b` |
| Candidate | `80dfe3f5a7d18731915bf9b6b770f816911b4f0f` | `b105d155bff6efd72967652fd340634f6444b8a9` |

Both reports record Node **v24.19.0**, V8 **13.6.233.17-node.51**, Linux x64,
AMD EPYC **9V74 80-Core Processor**, and nine logical CPUs. The benchmark CLI,
model harness, fixtures, limits, statistics helper, comparator, limiter, package
manifest and lockfile have identical Git blobs and SHA-256 hashes at both
revisions; [analysis.json](evidence/project16-followup-model/analysis.json)
retains that inventory. Read-only inspection confirmed each worktree's editor and
text package links resolved to its own packages.

The command was the following in each exact source worktree, with separate output
paths recorded verbatim in the summary:

```sh
node scripts/limited.js node scripts/benchmark-editor.js --backend model --sizes 1024,1048576 --samples 101 --warmups 10 --output CAPTURE.json
```

Each capture has ten rows: five operations at 1 KiB and 1 MiB. Every row contains
101 unmodified warm samples, one separate cold result, and ten warmup invocations.
That is **1,010 retained warm samples and 1,120 timed invocations per capture**,
or 2,020 retained warm samples across the pair. Warmup timings are not retained by
the unchanged harness. All retained p50/p95/p99 values were recomputed from the
raw samples and agree exactly; nearest-rank indices are 51, 96 and 100.

## All measured rows

Times below are milliseconds, rounded only for display. Signed differences are
candidate minus baseline. Full precision, cold samples, p99 and raw observations
remain in the linked JSON. Flags use the unrounded values.

| Size | Operation | Baseline median | Candidate median | Delta ms | Delta % | Above 5% |
|---|---|---:|---:|---:|---:|---|
| 1 KiB | Edit | 0.015484 | 0.014762 | -0.000722 | -4.663 | No |
| 1 KiB | Paste 64 KiB | 0.395997 | 0.412812 | +0.016815 | +4.246 | No |
| 1 KiB | Undo 64 KiB | 0.008893 | 0.010096 | +0.001203 | +13.527 | **Yes** |
| 1 KiB | Literal find | 0.047191 | 0.026650 | -0.020541 | -43.527 | No |
| 1 KiB | Line lookup | 0.011948 | 0.012148 | +0.000200 | +1.674 | No |
| 1 MiB | Edit | 0.012289 | 0.016645 | +0.004356 | +35.446 | **Yes** |
| 1 MiB | Paste 64 KiB | 0.386252 | 0.396979 | +0.010727 | +2.777 | No |
| 1 MiB | Undo 64 KiB | 0.008332 | 0.008964 | +0.000632 | +7.585 | **Yes** |
| 1 MiB | Literal find | 15.282964 | 15.567623 | +0.284659 | +1.863 | No |
| 1 MiB | Line lookup | 0.043365 | 0.044367 | +0.001002 | +2.311 | No |

| Size | Operation | Baseline p95 | Candidate p95 | Delta ms | Delta % | Above 5% |
|---|---|---:|---:|---:|---:|---|
| 1 KiB | Edit | 0.060411 | 0.030106 | -0.030305 | -50.165 | No |
| 1 KiB | Paste 64 KiB | 0.548057 | 0.632273 | +0.084216 | +15.366 | **Yes** |
| 1 KiB | Undo 64 KiB | 0.027771 | 0.040901 | +0.013130 | +47.280 | **Yes** |
| 1 KiB | Literal find | 0.082694 | 0.095864 | +0.013170 | +15.926 | **Yes** |
| 1 KiB | Line lookup | 0.062505 | 0.039159 | -0.023346 | -37.351 | No |
| 1 MiB | Edit | 0.027391 | 0.048323 | +0.020932 | +76.419 | **Yes** |
| 1 MiB | Paste 64 KiB | 0.614887 | 0.508477 | -0.106410 | -17.306 | No |
| 1 MiB | Undo 64 KiB | 0.022173 | 0.018658 | -0.003515 | -15.853 | No |
| 1 MiB | Literal find | 18.100623 | 27.890755 | +9.790132 | +54.087 | **Yes** |
| 1 MiB | Line lookup | 0.090476 | 0.063245 | -0.027231 | -30.097 | No |

The reviewer explicitly accepts the 1 MiB edit's **+0.004356 ms median /
+0.020932 ms p95**, the 1 KiB undo's **+0.001203 / +0.013130 ms**, and the 1 KiB
paste's **+0.084216 ms p95**, with the complete row set above remaining visible.
The unchanged-path 1 MiB find result, **+9.790132 ms p95 (+54.087%)**, remains a
recorded regression. Its cause is not established; it is neither dismissed nor
removed from the gate. Improvements elsewhere do not offset failing rows.

## Measurement boundaries and limitations

Only synchronous `operation.run()` is timed. Edit and paste include preparation,
model commit, history recording and event creation, with no subscribers. Undo
includes model history restoration and notifications; its preceding paste is
outside timing. Verification, undo cleanup and history clearing are outside
timing. Find and line lookup exercise unchanged text paths. Line lookup reads up
to sixty lines; the 1 KiB fixture has fewer than sixty. No view, DOM, paint,
provider work, native input or clipboard operation is measured.

The new weak collections are allocated per model, not per edit. Ordinary edits
perform extra weak-collection and ownership checks; undo also constructs a
notifications array. This capture measures the candidate as a whole and does not
isolate causal cost. JIT, GC, scheduling, run order and clock resolution can affect
these short observations. One ordered pair on a shared host provides no
statistical speedup or non-regression proof. These limitations do not waive the
5% failures. No allocation or retained-memory measurement was performed;
`createMs` is one constructor observation per size, not 101 samples.

## Retained decision and artifacts

The unchanged comparator was run only against the captured JSON with
`--threshold 0.05`. It returned **exit code 1**, with `passed: false`, five failed
p95 rows and no environment mismatch. The [comparator result](evidence/project16-followup-model/comparator.json),
[output log](evidence/project16-followup-model/comparator.log), and exact source
snapshot are retained. Median flags are additional disclosure, since this
comparator gates p95 only. Its ordinary 20% default was not used.

The [evidence directory](evidence/project16-followup-model/README.md) contains the
unaltered baseline, candidate, capture summary and logs, along with the derived
comparison and SHA-256 manifest. This documentation batch performs only copying,
hash/percentile arithmetic and the pure comparator. It runs no new capture,
benchmark, test suite, build or browser qualification.
