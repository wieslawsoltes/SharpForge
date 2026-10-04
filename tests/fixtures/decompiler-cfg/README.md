# Decompiler control-flow graph — SF-A13-T07.1

The decompiler facade now runs decoded control-flow analysis before the existing
conservative C# lowering. Opcode reconstruction is extracted into readable handler
modules. The CFG reuses `verify/dataflow-blocks.js`; there is one block splitter.
Instruction decoding, prefix-group boundaries and exception geometry reuse their
existing CIL services. The pipeline reuses its already decoded method.

## Corpus and independent evidence

`input.mjs` contains manually reviewed expected block ranges, instruction ownership
and edge tuples for empty/return bodies, short/long/backward branches, loops,
duplicate and empty switch tables, unreachable Int64 instructions, prefix groups,
`jmp`, catch, filter, finally, fault and nested finally boundaries. Expected graphs
are authored separately from the implementation. All instructions, including
unreachable ones and prefix records, belong to exactly one block.

`Program.cs` captures CoreCLR's own IL bytes and exception-clause offsets for
Roslyn-built diamond, loop, switch, finally and nested filter/finally methods. It
also records observable filter/finally outcomes. The capture retains exact pinned
toolchain/environment data, source/image hashes, compiler command and raw process
results. The existing `eh-encoding/native.json` independently supplies SRM and
CoreCLR evidence for hand-authored filter and fault assemblies; the reference test
checks their image hashes before reusing their clauses. Native opcode flow facts
come from the existing complete Reflection.Emit descriptor capture.

CoreCLR's public reflection API supplies method bytes and EH facts rather than a
public basic-block graph. The exact graph oracle is the hand-checked tuple corpus;
the native comparison qualifies byte identity, boundary geometry, opcode flow
facts and eventual branch/switch/leave destinations. It does not claim equivalence
to an internal JIT CFG or infer dynamic exception dispatch.

## Scope

The immutable versioned snapshot contains only scalar records and arrays. Edges
are normal `branch`, `switch`, `fall-through` or `leave` edges. A leave edge records
its eventual IL target and `clearsStack: true`; intervening finally execution is
outside this graph. Exception clauses contribute all their start/end/filter
boundaries, but no guessed handler/finally dispatch edges. Dedicated region trees,
SSA, dominance, loop nesting and structured exception source remain separate
leaves #2548, #2549 and #2550. This batch does not widen the legacy C# reconstruction
families or their existing `complete` claims.

Malformed instructions/targets, invalid options, code/instruction/edge/clause
limits and cancellation have stable CILCFG diagnostics. Existing geometry/prefix
failures preserve CILR codes. Graph source failures retain complete IL with an
explicit diagnostic; an otherwise valid CFG stays accessible when C# lowering
falls back. Limits and cancellation propagate instead of being reported as source
reconstruction failures.

## Retained validation and replay

The focused Node run at implementation commit `b86dc790` passed **78 of 78 tests**,
with no failures, skips or cancellations. [node-results.txt](node-results.txt)
retains the exact output, including the existing managed-IL and shared dataflow
regressions. [evidence.json](evidence.json) records implementation/tree identity,
source/configuration hashes and the retained log/reference hashes.

The native capture succeeded for **five Roslyn-built methods** on .NET SDK
10.0.201, CoreCLR/reference pack 10.0.5 and Roslyn 5.3.0-2.26153.122, linux-x64.
The retained [native.json](native.json) includes source/image/compiler/reference
hashes, compiler arguments and raw execution results. The local OS environment is
recorded; it is not an immutable runner image. [native-capture.txt](native-capture.txt)
retains the compact capture output. The comparison does not claim a CoreCLR/JIT CFG
oracle; its independently observed IL/EH facts are described above.

Replay the focused gate through the resource wrapper:

```sh
node scripts/limited.js node --test \
  tests/a13-07-cfg.test.js \
  tests/a13-07-cfg-reference.test.js \
  tests/managed-il.test.js \
  tests/a03-verifier-dataflow.test.js
```

The committed native reference is sufficient for offline tests. Regenerate it only
when needed, with the pinned toolchain available; this command compiles/executes the
reference and writes the named file:

```sh
node scripts/limited.js node tests/fixtures/decompiler-cfg/capture.mjs tests/fixtures/decompiler-cfg/native.json
```

`browser.mjs` exports `run()` for the existing browser module harness. It exercises
the graph corpus, diagnostics/limits/cancellation/ownership, pipeline behavior and
native reference replay through the browser JavaScript API. It does not execute
managed IL. No passing browser result is retained for this batch; browser
qualification remains pending. These graph/pipeline APIs are host JavaScript
analysis. The existing managed-IL regressions in the focused gate do not establish
new source-VM, direct-CIL, Rust-native or Rust-Wasm graph execution targets or broader
platform coverage.

## CFG feature-cost benchmark

`packages/cil/tools/benchmark-decompiler-cfg.mjs` compares the pre-CFG
`decompileMethod` implementation at `8b101c0c` with candidate CFG source at
`b86dc790`. Run the driver from the candidate checkout; it imports the baseline
library directly, so the baseline needs no copied driver or source change. Both
checkouts need their ordinary workspace package aliases. The driver verifies and
records that the fixture's CIL import and CIL's direct sibling dependencies resolve
inside their respective checkouts.

```sh
node scripts/limited.js node packages/cil/tools/benchmark-decompiler-cfg.mjs \
  --baseline /path/to/pre-cfg-checkout \
  --output /existing/directory/decompiler-cfg-benchmark.json
```

It uses the independently authored arithmetic `Add` assembly plus the captured
native `Loop` and `Finally` methods. Each library constructs its own inspector and
prewarms the method lookup. Before and after timing, the driver requires identical
legacy token/name, diagnostics, source text, language and `complete` output. The candidate's additional graph
dimensions are recorded separately. `Finally` must remain a full-IL source fallback.

For each case and variant it performs 20 warm batches, then 100 measured batches of
200 calls. Variant order alternates and case order rotates. The output retains every
measured sample chronologically, the median and nearest-rank p95 in nanoseconds per
call, source/image/driver hashes, revisions and host configuration. Inspector setup,
equality checks and summarization are outside timing. Existing IL-formatting work
inside the fallback remains part of the operation.

The comparison reports the cost of adding CFG output to an existing API. It is not
a same-result speedup comparison. The shared-host caveat is recorded; there is no
allocation counter, forced GC or isolated opcode measurement. The completed single
cohort is retained in [benchmark.json](benchmark.json), with all 600 chronological
measured batches and byte-exact output in [benchmark-output.txt](benchmark-output.txt).
The run used Node 24.19.0 on Linux x64, AMD EPYC 9V74, on a shared host.

| Workload | Baseline median / p95, microseconds per call | CFG median / p95 | Median change |
| --- | --- | --- | --- |
| Arithmetic Add | 2.884545 / 5.717910 | 5.143637 / 9.817140 | +78.317% |
| Native Loop | 6.692468 / 15.151085 | 10.482545 / 20.409215 | +56.632% |
| Native Finally fallback | 1297.793962 / 1582.885535 | 1271.563163 / 1650.063910 | -2.021% |

The first two medians exceed the unchanged 5% regression policy; publication
requires explicit performance justification and sign-off in the PR. The added
owned CFG costs about 2.26 and 3.79 microseconds per call on these fixtures. The
comparison preserves all old output fields but adds the graph, so it is a feature
cost measurement. No speedup is claimed for the fallback result. Node test
durations are not performance evidence.

Graph splitting/projection uses O(I + E + C) time and storage; existing EH geometry
validation additionally sorts O(C log C) intervals and uses a bounded instruction
boundary bitmap. Input and output limits are independently documented in the CIL
README. No speedup or heap measurement is claimed.

Specification: [ECMA-335, sixth edition, I.12.4 and III.3.46](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
