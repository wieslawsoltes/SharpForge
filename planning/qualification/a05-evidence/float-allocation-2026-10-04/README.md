# A05 double-loop allocation measurements — 2026-10-04

The final measured candidate removed float wrappers, repeated stack backing
allocation and temporary integer-store addresses from the tested loops. Both
variants completed one million measured iterations with **zero float carriers,
zero managed/frame allocations and zero collections inside the measured loop**.
The diagnostic protocol also showed no allocated-byte growth when measured work
increased from 100,000 to one million iterations. These observations do **not**
establish an exact count of every JavaScript host object: the remaining bounded
host cost is retained, and the reports keep that broader count unqualified.

All six original reports are unchanged. Each adjacent `.traces.tar.gz` contains
the original raw trace files, with names matching the report's `tracePath`
basenames. Absolute paths in a report identify its original execution workspace;
[manifest.json](manifest.json) maps those originals to archive members and records
SHA-256 digests for every report, archive and raw member. Decompressing an archive
does not require the original workspace. Archives use deterministic metadata.

Every run used Linux x64, Node 24.19.0, V8 13.6.233.17-node.51 and a 512 MiB child
heap. The reports include environment fingerprints, commands, harness hashes,
before/after source hashes for exact float-factory instrumentation, and identical
clean Git revisions at measurement start and completion. No native, browser,
source-VM or Rust execution is qualified by these Node CIL measurements.

## Measurements

Each cell below is **100,000 / 1,000,000 measured iterations**, in V8-reported bytes
above the corresponding warmed zero-iteration control. These bytes are not an
object count. Every typed/mixed row had zero exact `float()` carrier allocations;
the generic positive control detected **70,000 carriers in 10,000 iterations**.

| Raw report | Exact revision prefix | Warmup slices | Double induction bytes | Mixed Int32 induction bytes | In-loop GCs at 1M, double/mixed |
|---|---|---:|---:|---:|---:|
| [Initial](a05-float-allocation.json) | `b0a2ed28e30c` | 1 | 93,973,672 / 936,556,728 | 67,888,104 / 672,969,168 | 27 / 20 |
| [Retained storage](a05-float-allocation-retained.json) | `4e716d790634` | 1 | 316,840 / 334,096 | 585,816 / 725,880 | 0 / 0 |
| [Unlimited deadline guard](a05-float-allocation-unlimited.json) | `bb61b47f3276` | 1 | 312,384 / 301,968 | 575,920 / 709,816 | 0 / 0 |
| [Partitioned warmup before boundary fix](a05-float-allocation-warm-slices.json) | `bb61b47f3276` | 10 | 27,944 / 26,984 | 59,680 / 183,648 | 0 / 0 |
| [Numeric boundary fix](a05-float-allocation-single-boundary.json) | `b0b1a20db65f` | 1 | 307,704 / 325,960 | 564,432 / 554,400 | 0 / 0 |
| [Partitioned warmup after boundary fix](a05-float-allocation-single-boundary-warm-slices.json) | `b0b1a20db65f` | 10 | 27,944 / 27,944 | 32,048 / 30,320 | 0 / 0 |

All protocols perform the same 100,000 total warmup iterations, the same guest
operations and exact dyadic result checks, followed by the same measured counts.
The default protocol uses one warmup slice. The explicit diagnostic option
`--warmup-slices 10` partitions that warmup across ten real calls; it must not be
silently substituted for default-protocol evidence. Both versions are retained.

## Causal checks and limits

- Retaining private stack backing storage removed the large linear allocation
  observed when repeated pops shrank and regrew the backing Array. Public lengths,
  holes, enumeration, frozen/customized arrays, reference clearing and snapshots
  retain their existing semantics.
- Explicit `Infinity` slices now omit impossible periodic deadline clock reads
  while retaining start/end elapsed timing. Exact clock-call tests cover finite,
  `NaN`, string and negative-infinity budgets. This change did **not** explain most
  remaining allocation, so no such attribution is claimed.
- Numeric execution previously declined a one-instruction remaining budget. At a
  256-instruction boundary, an integer store could then construct a temporary
  address through its generic handler. Guarded numeric execution now accepts that
  final instruction. A real address-call control observed 513 integer stores in
  the reference fixture and zero temporary addresses in the optimized fixture.
  One-instruction PC, stack, local and return comparisons remained identical;
  debugger/write-observer controls still observed all 1,026 stores.
- With that fix, the default protocol retained only a small remainder as the loop
  length increased. Partitioned warmup reduced that remainder further. Its
  precise attribution to host entry, compilation or other fixed work has not been
  established. Neither absence of a collection nor zero managed-heap counters is
  presented as an exact all-host-object counter.

The final focused selection covered 53 unique tests. The first run passed 51 and
exposed two new test expectations that compared raw `vm.returnValue` to a Number;
that internal boundary preserves the canonical frozen `r8` carrier. Commit
`b0b1a20db65f` corrected those expectations to `float(128)` plus reference equality,
without changing product code. All three affected boundary tests then passed.
The final trace archive retains both validation logs. The other 50 tests passed,
including IEEE arithmetic boundaries, quotas, cancellation, host mutations,
snapshots, inherited managed roots, primitive replacement widths and raw NaN bits.

Reproduce the final protocols serially from the exact measured revision:

```sh
SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node bench/vm/float-allocation.js \
  --runner a05-linux-x64-node24 --out artifacts/final-default.json
SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node bench/vm/float-allocation.js \
  --runner a05-linux-x64-node24 --warmup-slices 10 --out artifacts/final-partitioned.json
```

The CLI intentionally exits with status 2 for partial qualification. Destinations
use exclusive creation. The fresh result must record its own environment and
revision; reproducing the command alone does not reproduce this runner's evidence.
