# Archive notes

This observation commit preserves the complete priority measurements from the
published product `312cd9242a492ce6f03e7e034a51cc17669a7edf`. It is separate
from the subsequent source-profiler optimization commit. The measured product
and generated reference were never modified during measurement.

All files listed in `SHA256SUMS.json` are byte-identical to their external raw
counterparts. The checksum manifest itself is copied unchanged. The additional
`checkout-verifier.py` is the exact read-only verifier recorded by SHA-256 in
`checkout-setup.json` and `checkout-after-priority.json`; its original script path
is retained in the raw provenance. These notes and the verifier are archival
additions, not changes to the original measurements.

The exact inner measurement commands are in each report. Each ran sequentially
through `node scripts/limited.js` with `SHARPFORGE_TEST_CONCURRENCY=1`,
`SHARPFORGE_MAX_PARALLEL_RUNS=1`, and `SHARPFORGE_MAX_OLD_SPACE_MB=512`.
The three qualification commands used `--expose-gc`. The reference generator
used the same wrapper and resource environment.

Fibonacci and virtual selected their existing target definitions with 100 pairs,
3 warmups, ABI64, seed 12012, 10,000 bootstrap resamples, and a 900-second limit.
Profiling selected `--suite profiler --profiler-mode off`, 100 pairs, 10 warmups,
ABI64, the same seed/resamples, and an 1800-second limit. No enabled-profiler
acceptance is inferred. Raw absolute paths identify the historical checkouts;
a new measurement must create and verify its own exact-parent reference.

The headline results remain Fibonacci inconclusive, virtual missed, and
profiling-off missed. See `README.md` for the complete table. These reports are
not T12 baseline files and do not establish remaining Project 7 acceptance.
