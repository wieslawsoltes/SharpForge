# Corrected ordinal admission: prepared qualification overlay

The product correction is committed at
`edafb8018be5b75916c8655e9ff1147b38035a24`. The Module ordinal now rejects after
format admission and before aggregate map/heap interpretation. The diagnostic
code/message and original failing assertion are unchanged. Added assertions
compare generation, identity, counts, retention counters, heap summaries and
populated table pages after physical/caller ordinal rejection.

This overlay is source preparation only. No corrected-source capture, test or
benchmark has run. The first capture and failed 50/51 gate remain immutable in
`../reference/` and `execution-first/`; their source remains `8b9b74f6`. The
original validation plan and its prepared-state documentation remain historical
protocol records. This document and the overlay describe the corrected revision.

## Separate product and tool revisions

`ordinal-source-revision.json` records the two changed product/test file hashes
and the preserved first failure. `ordinal-validation-plan.json` binds the fresh
paths, source revision, immutable original plan, explicit commands and scope.
`ordinal-run-step.py` is the prepared recorder; it verifies the overlay hash,
original recorder/plan hashes, current product/test bytes and every preexisting
evidence file before and after each phase. Its source is not executed by reading
this plan.

The benchmark's exact three-file zero-context revision is retained in
`ordinal-benchmark-pin.diff`, SHA-256
`20c2648e60779936b8b051158d81197e2aa95be617e27cf091eb0fbd79cadb8d`.

| Benchmark identity | Prior | Corrected preparation |
| --- | --- | --- |
| Baseline source | `31900dce` | Unchanged |
| Measured product pin | `02df6354` | `edafb801` |
| Immutable plan's preparation product pin | `02df6354` | Unchanged, checked separately |
| Strict native reference | `reference/` | `reference-ordinal/` |
| Reader worker and its two-import allowance | Original source/hash | Unchanged |
| Twenty workloads, fifteen children, 20 warm/100 measured batches | Original protocol | Unchanged |
| Timing, statistics, result guards and chronological samples | Original helpers | Unchanged |

The reference path changes because corrected-source strict provenance needs a
fresh capture while the first capture must stay unchanged. The orchestrator and
feature worker receive this fixed directory through the existing protocol. The
benchmark tool manifest also records the new overlay, receipt, exact revision and
recorder. No measured operation or workload count changes.

## Scheduled commands

Run only after root assigns the heavy slot. From the candidate checkout, invoke
one phase at a time and inspect its actual result before proceeding:

```sh
python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py native
python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py verify-external
python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py retain-native
python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py verify-retained
python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py focused
```

The recorder runs the exact `node scripts/limited.js` commands from the overlay
with one run slot, test concurrency one and the 2,048 MiB heap setting. It records
the inherited environment and actual Node-wrapper process outcome. The copy
phase creates exactly twenty new reference files with byte/hash comparisons; it
does not copy temporary observer or SDK payloads. Every phase refuses overwrite
and requires successful retained outcomes for all preceding phases.

Fresh external directories are
`project6-metadata-generations-native.ordinal-edafb801-first` and
`metadata-qualification-ordinal-edafb801-first`, under the session scratch root.
Retain the native payload in `../reference-ordinal/` and wrapper evidence in
`execution-ordinal-first/`. Preserve raw bytes, including whitespace and failures.

The unchanged eleven-file gate replays the original native reference on the
corrected product. The fresh native capture independently observes and replays
the corrected source, with explicit-path strict verification against that source.
These are separate provenance claims. Raw native subprocess coverage remains the
four workload commands; existing toolchain version probes have resolved identity
records without raw probe output.

After actual success, retain and commit native/gate evidence so the measured
checkout is clean. Prepare only the minimal sparse `31900dce` baseline using the
original plan. With a newly confirmed quiet slot, run the single predetermined
performance cohort:

```sh
python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py performance
```

That phase invokes the unchanged benchmark CLI with the new external destination
`project6-metadata-generations-performance.ordinal-first`. It never retries,
changes sample counts or grants performance acceptance. Preserve every raw
result and independently recompute all statistics, including regressions.

Stop and release the slot after any failed phase. No prepared command here is an
execution result or an authorization to run while another team job owns the slot.
