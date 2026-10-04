# Hosted qualification contract checkpoint — 2026-10-04

The focused eight-file selection passed **48/48 tests**, with zero failures,
skips or cancellations, at clean unchanged revision
`062b3b899d8dd36a696ee0e028e5951d86e98139`, tree
`a48712f9873d7c4948619ed6e3654d7e53e81d63`.

The [original execution journal](focused-execution.json) records Node v24.19.0,
the exact serial command through `scripts/limited.js`, resource controls 1/1/512,
start/end identities and timestamps, and exit zero. The [original TAP](focused.tap)
reports `17153.145717 ms`. The selection covers hosted orchestration, Wasm/array/
byref latency contracts, qualification options, the float iteration criterion,
snapshot retention protocol and profiler-reference integration.

Independent static review confirmed that the hosted float plan uses the existing
seven-child protocol: typed/mixed zero, 100k and 1M work plus the generic 10k
allocation control, with the prescribed ten warmup slices. The snapshot plan
preserves parent `--expose-gc`, 128 original-record captures and the 256 MiB cap.
Both drivers produce flat sibling report and trace files, including failure logs,
which the artifact inventory can retain.

The reviewed memory guards require the expected report formats and protocols and
recompute the existing pure assessment functions. They require the seven float
trace records, or 128 snapshot captures and 128 equal full-copy restores with the
expected cap and record mutation unit. Contract tests use retained historical
reports as positive inputs, then change raw allocation bytes or restore counts
while leaving copied acceptance labels unchanged; those inconsistent reports
are rejected. Historical data used in these tests is not a fresh measurement.

The [manifest](manifest.json) hashes both original files, which remain
byte-identical, and identifies five reviewed source blobs verified against the
tested revision. No full hosted 25-command queue, fresh timing target, native CLR
or browser qualification is claimed here. Separate static, license and build
checks were pending at this checkpoint, so their active outputs were not copied.
No heavy work ran during archival, and overlapping test counts must not be added.
