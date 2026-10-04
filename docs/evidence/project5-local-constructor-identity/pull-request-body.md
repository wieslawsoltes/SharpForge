## Problem

A source class named `Button` or `Line` could resolve to its own local constructor
in metadata and admission, then allocate an unrelated WinUI object at runtime.
Framework alias lookup selected the platform constructor contract before the
local allocation path. This skipped the user constructor and caused later local
field or method accesses to fail their legitimate receiver checks.

## Change

The existing runtime call-selection seam now skips intrinsic selection when it
has already resolved a concrete local method target. Local allocation and the
local constructor body execute with their declared MethodTable. External
framework constructors retain their contracts; managed delegates retain their
separate construction path. Receiver checks and compiler emission are unchanged.

The production delta is one line in `packages/runtime/src/execution/calls.js`.
Eight focused controls were committed before it, including observable local
constructor bodies and field initializers, local/framework coexistence, an
independent genuine framework constructor, raw MethodDef and MemberRef operands,
receiver rejection controls, and a local delegate named `Button`.

## Validation

| Capture | Result |
| --- | --- |
| Exact test-only parent `bd91c105a` | 3 passed, 5 failed, 0 skipped |
| Corrected source `4ff5a1ccb` | 8 passed, 0 failed, 0 skipped |
| Standalone publication source `cdfcf495c` | 8 passed, 0 failed, 0 skipped |
| Original consumer replay files at `4ff5a1ccb` | Both assigned object cases passed; five separate failures retained |

The original Shape/Button case now prints `3mine\n`; the pinned nested object
initializer prints `2\n1 2 3 0\n0\n`. Their original sources, expected results,
instruction budgets, and emitted PE bytes are unchanged. The remaining full-file
failures concern three exception-region admission cases, a generic List member,
and tuple fields. Earlier incomplete source-export/import attempts are preserved
alongside the completed captures.

The standalone branch contains only the owned delta through `-x` cherry-picks
above qualified main `41ebd76987aa912659310d4015607f46110358ab`; the canonical
consumer branch is not in its ancestry. Publication source head
`cdfcf495c6988989fba501441f52e6f2ea25a2b4` and tree
`3ab91c5692092db66985f90a0f49f03b2166fb21` remained clean through the eight-control
run. All materialized source blobs, all 14 local package aliases, and all three
DOTNET pins were retained and checked. The subsequent evidence commit changes
documentation and evidence only.

```sh
node scripts/limited.js node --test --test-concurrency=1 --test-reporter=tap tests/a05-local-constructor-identity.test.js
```

## Measured performance cost

The paired direct CIL benchmark compares exact `bd91c105a` and `4ff5a1ccb` runtime
graphs, whose only source difference is the call-selection line. It preserves the
fixed A, B, B, A, B, A, A, B process order and all 96 measured samples per side and
workload. PE bytes/hashes, output, return value, instructions, managed allocations,
and allocated bytes match across both sides; all numeric guard fields are present
and finite. The local workload performs 128 constructions and calls per sample.

| Phase | Local median change | External-only median change |
| --- | ---: | ---: |
| Admission | +7.43% | +14.04% |
| Execution | +21.58% | +5.42% |
| Total | +16.65% | +4.27% |

Local total median increased by 1.0904 ms and execution median by 1.1971 ms; local
total p95 decreased by 6.48%. The full record retains each median/p95 and all five
5% threshold breaches. The coordinating author/reviewer accepted this measured
cost for restoring legitimate local MethodDef identity while retaining receiver
checks. Its required publication-tree eight-control replay passed.

This is an explicit budget exception, not a passing speed budget or proof that
all latency variation was caused by the single line. The shared host and observed
process variation limit generalization. No timing rerun, native, browser, or Wasm
qualification was performed for this batch.

Full diagnosis, exact hashes, raw compressed logs, source inventories, benchmark
samples, and the reviewer disposition are in
`docs/cil-local-constructor-identity.md` and
`docs/evidence/project5-local-constructor-identity/qualification-manifest.json`.
Wider Project #5 canonical acceptance remains open.
