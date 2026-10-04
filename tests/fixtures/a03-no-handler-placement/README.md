# Handler-only instructions without EH clauses

Implementation-ready follow-up to #4380, under partial #2407. Qualification is
pending the single local validation slot; no passing or performance result is
claimed yet.

`verifyCilAssembly` now uses the existing lexical opcode-placement registry for
methods with no EH clauses. `rethrow`, `endfinally` and `endfilter` receive
`IL_EH_FLOW` with the existing `CILCF0001`, `CILCF0004` and `CILCF0005` diagnostics.
The error includes the byte offset and method token; stack propagation and
capacity proofs are withheld. Unreachable instructions follow the standalone
lexical validator's same rule. Filters remain inspection-only.

The small internal empty-region seam shares the placement functions; it does
not construct a tree or cursor and is not exported by the package entry point.
Validation is fused into the existing offset-index pass, O(instructions) time
and O(instructions) index storage. Direct Map writes replace temporary pairs
on this path. There is no new instruction scan, PE reread, decoder, allocation
per placement check or handler-bearing validation change. Existing bounds on
inspector decoding still apply; EH-specific budgets remain bypassed when no
clauses exist. Allocation design is not a measured peak-memory claim.

Four authored tests cover rejected reachable/unreachable placement, diagnostic
parity, withheld proofs, ordinary return/throw/branch behavior, cached decoded
records and mandatory source/image-provenance validation of native observations.
Six ILVerify cases are prepared: three ordinary positive bodies and three
handler-only negative bodies. The pinned SDK/runtime/tool helpers and parser are
reused; captures preserve raw output before assertions and never execute invalid
assemblies. Native expectations must be confirmed at the scheduled slot.

The scheduled batch will retain the first named regression's expected failure
against tests-first commit `8589a1918`, capture native results, run focused and
affected EH/runtime tests, compare fixed paired no-handler/catch/finally controls
using the existing `benchmark-handler-entry.mjs`, then run static/structure
checks. Every step uses the machine limiter, concurrency 1 and a 1 GiB Node heap.
Broader engines/platforms and typed catch/filter/member access remain separate.

```sh
node scripts/limited.js node tests/fixtures/a03-no-handler-placement/capture.mjs tests/fixtures/a03-no-handler-placement/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-no-handler-placement.test.js
```
