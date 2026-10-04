# Snapshot retention observations, 2026-10-04

Measured revision: `5909d54f25ef9898c956c736c96db782e36978ff`.
Runtime: Node `v24.19.0`, V8 `13.6.233.17-node.51`, Linux x64.
The immutable checkout was detached during the runs. Each child used a 512 MiB
V8 old-space limit, a five-minute timeout, and a 256 MiB post-GC
`heapUsed + external` retention cap. All three repository resource controls
selected one serial job/file and a 512 MiB Node limit. The
[manifest](manifest.json) retains exact shell commands, exits, byte lengths and
SHA-256 hashes for every unchanged raw report and log.

| Observation | Original record workload | Distributed byte workload |
| --- | ---: | ---: |
| Managed live bytes | 10,584,064 | 10,003,200 |
| Payload bytes in typed arrays | none | 10,000,000 |
| Mutation per snapshot | 82 of 8,192 records (1.00098%) | 100,000 bytes (1% of payload), spread across all 100 records |
| Captures / requested | 128 / 128 | 23 / 128 |
| Full-copy restore comparisons | 128, all equal | 23, all equal |
| Host snapshot-history increment | 12,005,896 bytes | 231,318,744 bytes |
| History increment / managed heap | 1.134337× | 23.124475× at the cap |
| Host live-plus-history increment | 15,542,248 bytes | 241,441,960 bytes |
| Combined increment / managed heap | 1.468457× | 24.136472× at the cap |
| Exact private snapshot typed backing | none | 230,000,000 bytes |
| Logical snapshot estimate / managed heap | 1.845990× | 23.001919× at the cap |
| Assessment | Bound met for this workload | Incomplete: cap stopped further captures |

The host increments subtract post-GC live or empty baselines respectively.
`arrayBuffers` is already included in `external` and is not added again. These
figures are not RSS or reserved allocator capacity. The distributed child stopped
at 274,353,201 absolute post-GC `heapUsed + external` bytes, above the
268,435,456-byte cap. Its 23 matching restores do not substitute for the required
128 versions. The raw assessment deliberately leaves its full-run bound result
unset and exits with status 2.

The [original clean report](original-clean.json) and
[distributed cap report](distributed-cap.json) both record the same start/end
commit and empty start/end worktree status. The original workload's full-copy
restore digest is
`8fce78a0cf873c119583cef20b93341275bb3cfdf220ae0cb8fb566bb752350f`;
the distributed workload's 23-version digest is
`c009083ec5a4342ee353f7515d7b28142e845a3abcf24b4f1b948d4d654421cc`.

The [first original attempt](original-invalid-provenance.json) also completed
128 restores, but unrelated transient synchronization files appeared during its
completion check. The harness rejected that run with `MeasurementRevisionError`
and exit 1. Its unmodified report and logs are retained for provenance; it is
excluded from the qualified observation above. The subsequent clean retry was
not substituted into the invalid report.

## Interpretation against #1387

The issue's deliverable explicitly calls for sharing unchanged records between
consecutive captures. Its numeric acceptance text says 1% mutation without
defining the mutation unit or record-size distribution. The existing fixture
uses small mutable object records alongside large immutable strings. The clean
measurement establishes the requested 128-version and less-than-two-heaps bound
for that documented record workload, including full-copy restore parity.

The distributed-byte case is an additional limitation check, not a redefinition
of the issue. Current whole-record sharing must copy every large array when a
small region in every array changes. It therefore does not establish a general
less-than-two-heaps guarantee for arbitrary 1%-of-bytes mutation. Cross-platform
and browser host-memory qualification, and whole-VM execution-frame retention,
remain separate; these Node ManagedHeap observations do not close those gaps.

The authored concentrated-byte workload remains unmeasured. Static accounting
predicts 227 distinct 100,000-byte record payloads after 128 versions: 99 unchanged
records plus 128 versions of one modified record, totaling 22,700,000 bytes.
That exact backing lower bound already exceeds twice its 10,003,200-byte managed
heap, before host object overhead. It is a representation consequence, not an
additional measured result. A further run could quantify host overhead, but
cannot establish the less-than-two-heaps bound for this representation.
