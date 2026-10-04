# Published36 priority measurements

Measured public revision: `36a2af53287a563fd47d3a33b8e6e6382a726d35`.
Full Git tree: `da3add4a11cce5ed887d2a093eac4b48a4c26754`.

| Target | Required speedup | Observed speedup | Paired bootstrap95%interval | Decision |
|---|---:|---:|---|---|
| Source Fibonacci | >=1.5x | 1.4961811853342564x | [1.459994839941652,1.5303095411438201] | Inconclusive |
| CIL virtual dispatch | >=3x | 2.283161499046044x | [2.201787518561151,2.4204059808342073] | Missed |

The runs used the unchanged selected target definitions,100 measured pairs,
3warmup pairs, one first-execution pair, native-int ABI64, seed12012,
10000resamples and900-second limit. Both modes therefore retain104 observations.
Cold construction/preparation, every first/warm/measured observation, percentile
summaries, allocation counters, options, fixture assembly hashes and exact host
provenance remain in the raw JSON. Both reports executed successfully, with no
execution errors, all output checks passed and exact paired instruction counts.
Their nonzero exits reflect target decisions: Fibonacci2, virtual1.

Fibonacci elapsed from19:55:12.977414UTC to19:55:31.197623UTC on2026-10-04.
Virtual elapsed from19:55:39.156903UTC to19:56:48.569546UTC. Each ran serially
through `node scripts/limited.js` with SHARPFORGE_TEST_CONCURRENCY=1,
SHARPFORGE_MAX_PARALLEL_RUNS=1 and SHARPFORGE_MAX_OLD_SPACE_MB=512.
The exact outer argv, inherited NODE_OPTIONS, exit status and file hashes are
recorded in the corresponding journal; the inner command and effective host
resource/heap provenance are in each raw report. No tests, profiles or additional
heavy workload ran between the two measurements.

The first Fibonacci launch failed before the qualification module loaded because
the historical sparse patterns omitted two newly introduced wrapper helper files.
Its complete attempt1 log/journal are retained, with no report or guest samples.
Only run-slot-lease.js and run-slot-owner.js were materialized from the frozen
commit; no source bytes or Git tree changed. A complete verifier then passed and
Fibonacci restarted as attempt2. Virtual used attempt1. No measured observations
were discarded, repeated or trimmed. See WRAPPER-SETUP-FAILURE.md.

The full index stayed clean, all4620materialized tracked blobs and own-package
links passed verification before the measured attempts and again afterward.
The earlier ca97 revision was setup-only and never measured; its separate setup
evidence was retained when required main reconciliation produced this revision.
Historical312 evidence remains archived independently, and its hook-free reference
commit remains protected by codex/a05-profiler-reference-historical-312. Its old
live dependency links are invalidated by reuse of the product checkout; they
cannot support a new312 measurement without reconstructing that product.

These observations do not qualify either target as met, do not constitute T12
baseline evidence, and do not establish profiler-off, native CLR, browser,
root-visitor, allocation, fairness or snapshot acceptance for this revision.
No new profiler reference or profiler measurement was run in this batch.

report-validation.json is read-only consistency checking of these completed
reports. checkout-verifier.py is the exact verifier identified by the setup and
post-run metadata hashes. SHA256SUMS.json records the retained evidence bytes.
