# SF-A03-T09.3 / #2417 PE bounds qualification preparation

**Prepared source only. No test, capture, benchmark, browser or build has run.**
The behavior contract is in [`packages/cil/PE-BOUNDS.md`](../../../packages/cil/PE-BOUNDS.md).
The baseline is `75f0caad1c3ea096a656feb2989b867781edc82f`; product admission is
`6e3d26f3ec6abe54699fce1caefa57e9a5c569f5` after the separate checked-range seam
`cbf5bb1c54608d5d4114c8873af0bf5a008919f4`.

The authored corpus uses the existing public metadata and PE writer. Its 29
cases each run as PE32 and PE32+, with additional ownership/order, exact endpoint,
BSS, raw-padding and invalid-query checks. Rejected headers cover arithmetic
extremes, truncated tables, undersized/oversized headers, unreferenced raw/virtual
overlap, header overlap and empty raw pointers outside the file. Unusual accepted
cases are explicit tests, not inferred native parity.

`Program.cs` observes each image using PEReader/SRM without loading or executing
it. Header and metadata admission failures remain separate native fields.
`compareAuthored` checks SharpForge's declared policy and compares scalar facts
only when both readers admit the headers. Native acceptance of a rejected
SharpForge layout is retained as `product-rejects-native-accepts-headers`.
The inverse difference is also explicit. Neither outcome is rewritten as parity.

The same capture compiles the existing `pe-inspection/Program.cs` observer and
reuses its complete eight-group public comparison for the real native CFG IL
image and the two pinned ReadyToRun/mixed images. Supplied image paths are
verified against `pe-inspection/reference-images.json`. Existing license and
cache-only payload policy applies unchanged; no supplied image or its payload
is committed. Only our authored malformed fixtures are generated in the fresh
external capture directory. The original reference corpus remains unchanged.

The capture retains all six native workload commands with raw stdout/stderr,
actual argv, time/status, source hashes, environment and toolchain identities.
The existing toolchain version probes do not retain raw probe outputs; the
provenance claim is expressly six workload commands. All temporary inputs and
observer outputs remain on failure for diagnosis. `verify.mjs` checks strict
source identity and binds retained native JSON to every raw observer response.

`validation-plan.json` fixes capture, strict verification, exact retention and
focused commands before execution. Native files must be retained under
`reference/` before the strict native test is run. It must fail if absent; absence
does not become a skipped native test. Existing `pe-inspection/native.json`
contains a previous source receipt and is not rewritten by this batch. Its
source-sensitive test is replaced for this gate by the new strict capture test;
the old assertions and evidence remain unchanged.

After the root grants the slot, `python tests/fixtures/pe-bounds/run-step.py`
accepts one phase name: `native`, `verify-external`, `retain-native`,
`verify-retained`, `focused`, then `performance`. Inspect each outcome before
starting the next phase. The recorder preserves actual command/environment,
source snapshots, raw stdout/stderr, exit/signal, UTC times and disk availability.
It refuses prior-file overwrite and requires successful predecessor receipts.
The commands already contain `scripts/limited.js`; do not wrap it twice.

Performance uses five ordinary `readPE` workloads, each compared against the
exact baseline in separate fresh Node children: a small three-section image,
a maximum-96-section image, real native IL, real R2R and real mixed mode. The
first three use default read options; R2R/mixed require existing inspection mode.
Two preparation children compare full data facts and callbacks before timing;
ten measurement children run serially, alternating which side runs first per
workload. Each workload/side has 20 warm plus 100 measured batches, for 1,200
chronological batches. Fixed calls per batch are 128/32/64/25/25 respectively.
Every returned value is consumed and checked outside timing.

The benchmark reports true medians and nearest-rank p95/p99 of batch means in
microseconds per operation, all raw samples, signed net heap observations,
source/tool/native/input hashes, own public aliases and environment. Baseline
children import only their own package graph. Candidate imports in the parent
only construct shared input bytes; process startup/imports are not timed.
Dynamic loading is limited to the single fixed public entry after operator
checkout/source/alias checks and an exact source-hash/count allowlist check.
The new allowance requires root source review before execution.

One successful cohort does not approve performance regressions. Preserve every
result, including all greater-than-five-percent median or tail increases, for
independent review and explicit disposition. No retries/adaptive sampling are
part of this protocol. The team heavy slot must be explicitly granted before
any prepared execution. Source VM/direct CIL/Rust/Wasm do not execute this
JavaScript parser fixture; edited code execution and Windows mixed-mode loading
on Linux are unsupported. Browser source replay is prepared, not qualified.
