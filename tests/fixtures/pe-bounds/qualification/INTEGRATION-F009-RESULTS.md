# Integrated PE qualification: native and focused gate

The approved five-phase qualification completed once on 2026-10-04 at source
`74559c16430dbf50778afe96d3c19a7cc3ade8e4`, tree
`ce57ce0249f44c08e1306e83e0d0ae1f4c5dd64a`. The product remains the integration
merge `8f0f0feec8ed8955e6119a346051ec6fdd965760`, with comparison baseline
`f009e2949f3311f0ca84a4a6bc694535140d130b`. This evidence-only retention changes
no captured product, fixture, test, benchmark, recorder or plan bytes.

**Integrated performance is pending.** No new cohort, browser run, cross-platform
qualification, input-assembly execution or cancellation-injection exercise was
performed. The previous native capture, benchmark cohort and explicit
performance disposition remain historical and unchanged.

| Phase | UTC interval | Actual outcome |
|---|---|---|
| Native | 20:23:47.888460–20:23:52.171996 | 58 authored cases, three supplied real images, six native commands successful |
| Strict external verification | 20:24:16.544115–20:24:16.930788 | Passed against all 532 current captured source hashes |
| Exclusive retention | 20:24:25.232998–20:24:25.394804 | Thirteen native files copied byte-for-byte |
| Strict retained verification | 20:24:30.308674–20:24:30.665101 | Passed against the retained copy |
| Original seven-file focused gate | 20:24:36.135462–20:24:39.582542 | 91 passed, zero failures, skips, cancellations or TODOs |

All five outer receipts record exit zero, null signal, no interruptions, no
inspection errors and unchanged sources. Each before/after snapshot records
1,120 source files and seven owned aliases. Tracked working/index differences
are empty. After retention, the only untracked paths are the planned thirteen
native evidence files. All native-command and outer stderr streams are empty.
There was no retry, expectation edit or intervening source change.

The preflight recorded the exact clean HEAD/tree, approved plan/recorder hashes,
seven owned aliases and absent fresh destinations. Available disk was
696,958,976 bytes against the 402,653,184-byte minimum. Execution used Node
v24.19.0 on Linux x64, SDK 10.0.201 and runtime/reference pack 10.0.5. Compiler
and reference-assembly hashes, environment, command arrays and raw outputs are
in the retained native capture. Existing toolchain probes retain identities;
the six build/observer commands retain raw streams. No additional probe-log
coverage is claimed.

All three supplied real-image comparisons have an empty differences list.
The authored corpus preserves explicit policy distinctions: 20 cases are
accepted by both readers with equal header facts, 30 are rejected by SharpForge
where the native reader accepts headers, and eight are rejected by both.
Native acceptance of headers is not treated as proof that a stricter product
admission policy must accept the image.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| New native.json | 681,757 | `3180681b837454f9cefab3b3a7568517091d5b677d814e06c5b39657e141edd6` |
| Focused output | 6,192 | `e7a505d3b933da255211cc0c74ec1873ec22e5fffafe9b70a7769c0b8f2e07e5` |
| Plan | 9,793 | `1a25e65ee38bef4d6eb98d0002dea0da4855b0a279348b68063f996afae26a6f` |
| Recorder | 12,593 | `c37ff300592461d91768dd8d1088bdbdf63ed24932a5c3cfa19d67c861873def` |

`integration-f009-retention.json` provides the complete path, byte count and
SHA-256 manifest, exact phase receipt hashes, all actual command arrays through
the preserved receipts, source identities and pending performance command.
It accounts for 27 raw retained files totaling 2,283,215 bytes: thirteen native
files totaling 896,937 bytes, plus five outer receipts, eight outer streams and
the preflight receipt totaling 1,386,278 bytes. The manifest and this explanatory
document are additional derived files, outside those raw totals.

Retention independently checked every raw native command stream against its
stored text and hash, every raw observer result against the capture, every
outer output against its receipt, every native source hash, and every recorded
outer before/after source hash. It also confirmed all 95 historical evidence
and tool files retained by the preparation manifest remain byte-exact. These
were read-only standard-library data and source inspections; no product import,
native command or test was repeated. Original external files remain intact.
SDK binaries, generated observers and external input-image copies are excluded
from Git retention.

After a separate root performance grant, invoke the same prepared recorder's
`performance` phase with the final reviewed clean evidence-only HEAD. Its
before-state checks run before the limited benchmark command. It uses the
owned sparse `sf6-pe-bounds-baseline-f009e294` checkout, candidate product
`8f0f0feec8ed8955e6119a346051ec6fdd965760`, strict
`tests/fixtures/pe-bounds/reference-integration-f009`, and the fresh external
`project6-pe-bounds-performance.integration-f009` directory. All five preceding
receipts remain in `project6-pe-bounds-execution.integration-f009`; the future
performance receipt must be new. The 12-child protocol, timers, guards, 20 warmup
and 100 measured batches per side remain as prepared. No threshold pass or new
performance exception is implied by the successful native and focused gates.
