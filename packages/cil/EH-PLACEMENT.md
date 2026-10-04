# Exception instruction placement

`validateExceptionInstructionPlacement(code, handlers, options?)` checks
`rethrow`, `ret`, `jmp`, `endfinally`, `endfilter` and `tail.` source placement,
plus the required final `endfilter` in every filter. It returns the immutable
[lexical region tree](EH-REGIONS.md). `exceptionPlacementDiagnosticCatalog`
defines `CILCF0001`–`CILCF0007`; each failure includes its instruction's byte
`offset`. Input/layout errors retain the tree builder's `CILR` codes and limits.

An enclosing catch or filtered handler permits `rethrow` even from a nested
finally. `endfinally` requires the innermost region to be finally/fault. `ret`,
`jmp` and tail calls are forbidden inside any exception region. `endfilter`
must terminate its filter lexically, including unreachable code. These rules
follow ECMA-335 I.12.4.2.8.2.2–6. No existing execution path invokes this API.

This is the instruction-placement increment of #2397. Branch/switch/leave edges,
fall-through edges, stack typing, member resolution and opcode-specific prefix
legality remain separate. Success does not establish full control-flow or method
validity; callers needing execution verification must complete those checks.

The implementation reuses the region tree and existing opcode decoder. A second
bounded decode supplies instruction records after tree construction. An iterative
cursor consumes ordered region roots/children and tracks catch ancestry without
allocating per instruction or walking the full ancestor chain. Beyond the tree's
O(clauses log clauses) construction, the pass is O(instructions + regions), with
bounded decoded-instruction and region stacks. No recursive traversal is used.

Tests reuse existing native captures; no new ILVerify or platform result is
claimed. The completed lexical scope passed 228/228 tests in one scheduled serial run,
including all six placement tests and all parent tree/encoding/CIL compatibility
checks. Static/manifests passed (2,519 syntax / 2,515 static modules); structure
reported no changed-file findings. This validates the JavaScript metadata API,
not execution-backend or full ILVerify qualification.

On Node 24.21.0 / macOS ARM64 / Apple M3 Pro, 10 warmups and 15 GC-separated
samples measured complete tree-plus-placement median/p95 of 1.050500/1.258916 ms
for 1,000 shared-try clauses and 7.411083/10.197875 ms for 10,000. Median sampled
heap deltas were 1,680,000 and 14,497,176 bytes. These are not allocation totals,
peak or retained memory; no previous equivalent operation or speedup is claimed.
The development host was shared. All samples are retained in
`benchmarks/eh-placement-node24.json`.

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a03-06-eh-*.test.js tests/cil.test.js
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-eh-regions.mjs placement
```
