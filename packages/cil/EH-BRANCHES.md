# Exception branch validation

`validateExceptionBranches(code, handlers, options?)` returns the same owned,
frozen region tree as `buildExceptionRegionTree`. It includes instruction placement
checks, then validates ordinary short/long branches, every switch target, method
entry and lexical fall-through. Error `.offset` identifies the source instruction.

ECMA-335 I.12.4.2.8 permits entry at the first instruction of a try, including
several nested tries with that start. Every enclosing region still applies:
ordinary branches cannot leave a region, enter a try interior or enter a handler
or filter. Fall-through may enter a try but cannot exit any region, enter a handler
or filter, or run off the method. These checks include unreachable instructions.
Branch, switch and leave targets cannot split prefix groups.

This is an explicit validation seam, not a complete verifier. **Leave EH target
rules are not checked**; only their instruction-group boundary is checked here.
Use [`validateExceptionControlFlow`](EH-CONTROL-FLOW.md) to include leave rules.
Evaluation stacks, empty stacks on try entry, prefix/opcode compatibility, metadata
resolution and runtime integration remain separate scopes. Existing placement-only
and tree-only APIs preserve their behavior. There is no automatic activation in
the compiler or any execution engine.

The region builder's input, cancellation and lowerable hard limits apply: 16 MiB
code, one million instructions, 100,000 clauses and depth 1,024. Existing bounded
decoding is reused. The transfer index stores region-change offsets and membership
in typed arrays, plus one entry requirement per region; no map or ancestry list is
created per instruction or edge. For R regions, I instructions and E explicit
targets, transfer indexing/checking costs O(R log R + (I + E) log(R + 1)) time and
O(R + code bytes) additional storage after decoding, independent of nesting depth.

Diagnostics: CILCF0008 branch exit, 0009 branch entry, 0010 fall-through exit,
0011 fall-through handler/filter entry, 0012 method entry in handler/filter,
0013 method-end fall-through, 0014 prefix-group interior target. Existing CILR
and CILCF0001–0007 failures retain their meanings.

Tests reuse the recorded Roslyn async/hoisted-local/closure PE corpus and native
filter/fault fixture methods. The new verifier is JavaScript-only; no Rust/Wasm
or runtime verifier integration or ILVerify differential qualification is claimed.

Serial validation at `d31f84a0`: 43/43 focused EH branch/tree/placement tests,
2,598 syntax and 2,594 static module checks with zero errors; manifests valid,
no structure findings in changed files. Two initially malformed test fixtures
were corrected (conflicting filter payload and duplicate labels); product behavior
was not relaxed. Full native/browser/Rust qualification remains staged.

Node 24.21.0, Apple M3 Pro, shared macOS host, 10 warmups and 15 samples per size:

| Scope | 1,000 clauses median/p95 ms | 10,000 clauses median/p95 ms |
| --- | --- | --- |
| Placement before e35a69d0 | 0.890917 / 1.101958 | 6.279625 / 7.293000 |
| Placement after d31f84a0 | 0.918625 / 1.097584 | 5.285792 / 6.913375 |
| New branches, same count switch targets | 2.324042 / 2.506292 | 14.371250 / 23.832667 |

No control regressed more than 5%; the shared host does not support a causal
speedup claim. New-API median sampled heap deltas were 1,823,040 and 16,141,088
bytes; these are not total allocations, retained or peak memory. Exact control
harness, source revisions, commands and chronological samples are retained in
[the benchmark capture](benchmarks/eh-branches-node24.json). The initial historical
control used an older decoder and is explicitly retained as non-comparable data.
