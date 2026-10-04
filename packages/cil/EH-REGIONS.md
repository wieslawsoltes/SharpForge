# Exception region trees

`buildExceptionRegionTree(code, handlers, options?)` builds an immutable, owned
lexical exception-region tree from CIL bytes and the handler records returned by
`readPE(..., { inspection: true }).methodBody(token)`. It also accepts the named
`filterOffset` writer form. The existing decoder, opcode prefix metadata and
shared scalar clause validation are reused; no compiler or runtime path is
switched to this validator.

The result contains `codeSize`, `roots` (region IDs), `regions` and `clauses`.
Each region has `id`, `kind`, half-open byte offsets `start`/`end`, `parent`
(`null` for roots), `children` IDs and original `clauses` indices. Kinds are
`try`, `catch`, `filter`, `filter-handler`, `finally` and `fault`. Identical try
intervals share one node; handler precedence remains the original clause order.
Each clause has `index`, `flags`, `tryRegion`, `handlerRegion` and nullable
`filterRegion`. IDs index the corresponding result arrays. Roots and children follow lexical order. Input buffers and
objects are never retained, and all returned arrays and records are frozen.

The implementation follows ECMA-335 I.12.4.2.5 and I.12.4.2.7: own regions cannot
overlap; entries must be disjoint, wholly nested inside one non-filter region,
or mutually protect one shared try with catch/filter handlers. Nested clauses
precede their enclosing clauses. All boundaries must be full instruction-group
boundaries, including a prefix sequence's first prefix; a region cannot split
a prefix sequence from its instruction. End-of-code is a valid region end.

`exceptionRegionDiagnosticCatalog` documents stable `CILR0001`–`CILR0030` codes
for invalid input, limits, cancellation, scalar fields, each boundary and each
lexical relationship. Decoder failures carry `CILR0029` and the decoder message.
This validates lexical layout, not the control-flow restrictions of I.12.4.2.8:
stack typing, catch type resolution, required terminators, fall-through,
leave/rethrow/endfilter legality and opcode-specific prefix legality are separate
verifier work. A structurally valid tree is not a claim that a method executes.

Options lower hard bounds: `maxCodeBytes` 16 MiB, `maxInstructions` 1,000,000,
`maxClauses` 100,000, `maxDepth` 1,024. `signal` is checked before decoding and
through projection/tree construction. The reused decoder is bounded; this API
does not yield during synchronous decoding or sorting. Invalid limits fail
before allocation. Instruction boundaries use a one-bit-per-byte bitmap;
decoded instruction records are discarded before tree construction. Construction
costs O(code bytes + clauses log clauses), with O(code bytes + clauses) bounded
temporary storage. There are no pairwise region scans or recursive tree walks.

Offline reference tests reuse the hash-pinned Roslyn AsyncWriter, HoistedLocals
and ClosureMap assemblies and the previously executed filter/fault fixtures.
They do not rebuild native fixtures or claim new platform captures. Broader
compiler-fixture coverage and complete verifier/platform qualification stay open
on #2395.

Reference: [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).

Scheduled validation on Node 24.21.0 / macOS ARM64 / Apple M3 Pro passed all
228 tests in the completed lexical scope: 26 tree tests, 6 placement followup
checks, 6 encoding tests and 190 existing CIL tests. Parent tree product/tests
are byte-identical to the validated child at `9cf90694`. The three retained
Roslyn assemblies and native filter/fault fixtures all pass. Static/manifests
passed (2,519 syntax / 2,515 static modules, zero errors); structure found no
changed-file issues. Full platform and ILVerify qualification remains staged.

The existing writer benchmark compared `fc2ae0e8` with `9cf90694` (same baseline
writer/binary bytes as tree base `3f6ad657`), 500 warmups and 21 GC-separated
samples, 1,000 small or 100 large writes per sample. Median/p95 microseconds:

| Writer case | Before | After |
|---|---:|---:|
| 64 bytes, no EH | 0.815250 / 0.930792 | 0.837625 / 0.948708 |
| 64 bytes, catch | 1.330458 / 1.574292 | 1.255333 / 1.690500 |
| 64 KiB, no EH | 5.886250 / 7.808340 | 7.921250 / 10.718750 |

The CIL reviewer explicitly accepted the observed large control increase
(+2.035 microseconds median, +2.910410 p95) and catch p95 increase (+0.116208)
for shared scalar validation and the opt-in lexical capability. The no-handler
path/binary writer are unchanged, so causal attribution is uncertain. The host
was shared; no significance or general speed claim is made. All raw samples are
retained in `benchmarks/eh-regions-node24.json`.

New tree construction (10 warmups, 15 samples) measured median/p95
0.483833/0.607000 ms for 1,000 shared-try clauses and 4.198000/6.706459 ms for
10,000. Median sampled heap deltas were 1,146,496 and 8,842,248 bytes, not total
allocations, peak memory or retained memory. These are new-operation measurements,
not an existing-path speedup. Reproduction, always in the serial slot:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a03-06-eh-*.test.js tests/cil.test.js
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-eh-encoding.mjs
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-eh-regions.mjs
```
