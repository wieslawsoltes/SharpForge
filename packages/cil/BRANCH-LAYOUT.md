# Explicit CIL branch layout

`CilWriter.finishWithLayout({ maxInstructions, signal })` returns `{ code, offsetMap }`.
It resolves the writer's symbolic labels, selects short branch forms when their
signed displacement fits, and widens requested short branches when needed. Numeric
branch and switch targets are relocated as well. Non-branch instruction encodings
are copied unchanged. Compact local/integer selection remains the writer's separate
opt-in helper option.

`offsetMap` is a caller-owned Map from each original instruction boundary to its
final boundary, including original code length to final code length. Neither the
input writer, its labels, fixups nor recorded offsets are changed. Repeated calls
produce independent code/maps. Ordinary `finish()` keeps its prior contract,
including rejecting an out-of-range explicitly requested short branch. Nothing
automatically switches compiler emission, canonical replay, EH or debug maps to
the new API. Consumers must explicitly map their own offset-bearing data.

Targets must be actual decoded instruction starts. Missing labels, interior targets,
branches to the end boundary, malformed instruction bytes and inconsistent fixups
produce CilError. Prefix-group legality, stack validity and exception-region
transfers are verifier responsibilities; this API does not claim those checks.

Layout begins with all short-capable branches short. Each branch can widen exactly
once, by three bytes. Prefix sums use a Fenwick index with O(log n) updates/queries.
After a widening, only sources within 128 instruction indices on either side can
be affected while still short: each instruction occupies at least one byte, and a
short displacement spans at most 128 bytes. At most 257 candidates are examined
per widening. Work is O(n log n + switch targets), memory O(n + switch targets),
with the fixed 257-neighbor factor independent of method size. Widths only grow,
so the resulting fixed point preserves every branch that can remain short for
the fixed non-branch encodings.

The input limit is 16 MiB, with at most one million instructions, labels, fixups
and aggregate switch targets. `maxInstructions` can lower the instruction limit
to zero. Invalid budgets are rejected. Cancellation is checked before decoding,
between phases and during layout/emission. Decoding and target resolution are
synchronous bounded phases. There is no cache or retained global method state.

Validation: 205 focused branch-layout, compact, opcode and CIL tests pass. Native
.NET 10.0.5 executes all four fixture methods with matching results; SDK 10.0.201
builds the oracle without warnings or errors on macOS ARM64. Required check passes
(2460 syntax / 2456 static modules, zero errors). Structure has no findings in this
increment's files; existing repository findings remain. Broader compiler/EH/debug
integration and A00 qualification remain open under #2389.

Serial paired measurements use Apple M3 Pro / Mac15,6, Node 24.21.0, macOS ARM64,
2 warmups plus 7 samples. This was the sole scheduled validation process on a shared
host; the results do not establish statistical significance or a speedup. The
baseline is the exact public decoder at 3aca665d. Sampled heap deltas are not
allocation totals or peak/retained memory.

| Operation | Branches | Median ms | p95 ms | Median sampled heap delta |
| --- | ---: | ---: | ---: | ---: |
| Before decode | 1000 | 0.355584 | 0.365708 | 399512 B |
| After decode | 1000 | 0.291500 | 0.586416 | 383760 B |
| Before decode | 10000 | 2.856834 | 3.234500 | 4145184 B |
| After decode | 10000 | 2.054459 | 2.185916 | 2362800 B |
| Explicit layout | 1000 | 3.584375 | 3.766708 | 580208 B |
| Explicit layout | 10000 | 16.515625 | 25.930166 | 6935968 B |

Integration review explicitly accepts the 1000-branch decoder p95 increase of
0.220708 ms for the extraction/layout capability. The layout fixtures contain
5001/50001 input bytes and produce 4809/49809 bytes. These bounded synthetic
measurements support the capability's cost, not general memory or compiler claims.
Run `node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-il-layout.mjs LABEL decode|layout OUTPUT.json`.
All raw samples are committed in `benchmarks/branch-layout.json`.
