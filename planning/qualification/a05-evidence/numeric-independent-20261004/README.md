# Independent byref and native numeric replay, 2026-10-04

These reports preserve each actual execution result. They add evidence to the
original 83-item/210-criterion audit without modifying its historical assessment
or claiming that the whole project passed. Counts from different runs are not
summed into a synthetic passing suite.

| Revision and scope | Actual result | Retained evidence |
| --- | --- | --- |
| Clean `5379d076a`, byref GC stress | 6 passed, 0 failed, 0 skipped | [Execution](a05-independent-replay-5379d076a-20261004/byref-gc-stress-execution.json), [full stress report](a05-independent-replay-5379d076a-20261004/byref-gc-stress.json) |
| Clean `5379d076a`, native numeric replay | 4 passed, 7 failed, 0 skipped | [Original log](a05-independent-replay-5379d076a-20261004/numeric-differential.log) |
| Clean `139917fe5f`, native numeric replay after exact-source repair | 10 passed, 1 failed, 0 skipped | [Execution](a05-native-numeric-replay-139917fe5f-20261004/numeric-differential-execution.json), [log](a05-native-numeric-replay-139917fe5f-20261004/numeric-differential.log) |
| Literal/constant boundary repair | 16 passed, 0 failed, 0 skipped | [Focused log](a05-native-conversion-repair-b3673745c-20261004/a05-integer-literal-boundary-r2.log) |
| Literal/constant/floating repair equivalent to `b3673745c` | 18 passed, 0 failed, 0 skipped | [Focused log](a05-native-conversion-repair-b3673745c-20261004/a05-integer-floating-boundaries-r3.log) |
| Complete conversion matrix equivalent to `b3673745c` | 1 passed, 0 failed, 0 skipped; all 2,112 cases | [Matrix log](a05-native-conversion-repair-b3673745c-20261004/a05-native-conversion-matrix-r2.log), [repair manifest](a05-native-conversion-repair-b3673745c-20261004/completion.json) |

The final two runs used `d3c670cf8` plus the exact runtime/test changes then
committed as `b3673745c`. Their manifest records the committed equivalent tree
and changed-file hashes; it does not describe the test checkout as clean.
Original failing boundary and matrix logs are retained alongside the passes.

The complete `139917fe5f` replay includes the same saved C# program processing
100,000 operand pairs across 29 Int64/UInt64 operations through source,
assembly-reloaded source and direct CIL. All three routes passed in that test
(699,280.590 ms). The independent helper comparison also passed. The later
conversion-only repair does not change that source fixture, its native expected
file, operand count or Int64 arithmetic helpers. Its runtime change affects the
legacy floating-to-Int32 conversion branch; the Int64 program uses typed scalar
conversions instead. The compiler repair defers imprecise legacy integer-token
folding to the existing exact semantic binder. This is scoped support for the
recorded Int64 paths, not a claim that a full replay ran at `b3673745c` or any
subsequent integration revision. No second 100,000-case replay was performed.

The seven original compiler failures came from rebuilding source snippets
without the `using System;` context present in the native compilation. Commit
`139917fe5f` makes replay consume the saved, hash-verified `.cs` sources and adds
the same import to bounded conversion snippets. The original 19 native fixture
files and all expected values remain unchanged.

The remaining conversion failure exposed three independent boundaries:

1. The legacy syntax constant adapter treated the magnitude in the valid C#
   expression `-9223372036854775808L` as a signed Int64 before unary minus, then
   threw a host `RangeError`. The pinned Roslyn constants corpus explicitly
   accepts that spelling as `long` and classifies the positive token alone as
   `ulong`. Commit `d3c670cf8` defers imprecise integer tokens to exact binding.
2. Generated native input casts used `(nint)-1L`, which is ambiguous with a
   parenthesized contextual type name in C#. The fixture now spells the operand
   `(nint)(-1L)`, preserving its value and intended cast.
3. The legacy source conversion wrapped an already tagged floating value with
   `float(value)`. JavaScript converted the carrier object to NaN, so positive
   infinity incorrectly became integer zero. Commit `b3673745c` preserves the
   existing floating carrier before calling the same shared conversion policy.
   Constant folding remains distinct: the pinned Roslyn constant-cast results
   and native runtime saturation tests both pass.

For #1349, the actual matrix covers five source kinds and all 13 destinations
listed by its deliverable: `i1`, `u1`, `i2`, `u2`, `i4`, `u4`, `i8`, `u8`, `i`,
`u`, `r4`, `r8`, and `r.un`, with 33 opcode variants including checked and
unsigned-source forms. The original acceptance text says “15 targets”; this
archive preserves that discrepancy rather than inventing two destinations or
claiming that a literal 15-target count was exercised.

For #1370, the clean stress run contains 1,000 distinct seeded CIL assemblies,
131,341 instructions and exactly 131,341 actual collections. It covers field,
array and boxed-value owners, nesting depths one through five, 96 source/reload/
compiler-CIL counterparts, and negative controls removing byref owner rooting.
The report explicitly leaves native, Rust and browser qualification open;
source counterparts do not create unbox interiors.

Each execution used `scripts/limited.js`, `--expose-gc`, test concurrency one,
and the three resource settings `SHARPFORGE_TEST_CONCURRENCY=1`,
`SHARPFORGE_MAX_PARALLEL_RUNS=1`, and `SHARPFORGE_MAX_OLD_SPACE_MB=512`.
Preflight `runtime.heapLimit` belongs to the unwrapped metadata-inspection
process, not the child test process. Exact commands, runtime versions, resource
environment, clean start/end identities where applicable, and all 19 oracle
hash checks are retained. [The index](index.json) maps original criteria and
hashes every copied report. Copied raw reports are byte-identical to their
originals; original absolute scratch paths remain as provenance.

These are Linux x64 Node replay results against the saved .NET SDK 10.0.201 /
.NET runtime 10.0.5 macOS ARM64 oracle with 64-bit native integers. They do not
claim a fresh native execution, ABI32 parity, browser/Wasm/Rust coverage,
performance thresholds, or zero allocation. The passing float family and
conversion matrix support #1395's float-differential clause; its allocation
measurement remains separate.
