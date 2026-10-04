# Malformed opcode-name guard

`CilWriter.op` rejects unsupported or non-string opcode names with CilError before
changing bytes, labels or fixups. Inherited names such as `constructor`, `toString`
and `__proto__` cannot reach an opcode descriptor. Non-string objects are rejected
without invoking user-defined string coercion.

The shared catalog owns a frozen null-prototype internal name lookup containing
219 references to its existing descriptors. The public frozen CilOpcodes object
retains its shape and prototype. No opcode facts are duplicated, and no name lookup
map is constructed per writer or per instruction.

The regression fails against exact writer db446a7a with TypeError in `.startsWith`
after an inherited constructor is mistaken for an opcode. The corrected focused
suite passes all 203 tests, including state preservation, all 219 wire encodings,
scalar boundaries, switches, truncated operands and branch extremes. Required check
passes (2471 syntax / 2467 static modules, zero errors); structure reports no
findings in this increment's files.

Serial paired measurement: Apple M3 Pro / Mac15,6, macOS ARM64, Node 24.21.0,
65,536 integer/local instruction pairs, 2 warmups and 7 samples. The command is
`node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-compact-instructions.mjs LABEL OUTPUT.json`.
Baseline uses the exact db446a7a writer. Raw baseline, initial and final reports
are retained in `benchmarks/opcode-name-guard.json`.

| Writer | Default median/p95 ms | Compact median/p95 ms |
| --- | ---: | ---: |
| Baseline | 4.091334 / 8.200541 | 4.369792 / 6.958750 |
| Initial Object.hasOwn per opcode | 6.525000 / 10.043959 | 6.518834 / 9.404958 |
| Final catalog-owned direct lookup | 2.353000 / 5.362541 | 2.827042 / 5.370667 |

The initial +59% default median cost motivated one bounded alternative measurement.
Final output sizes remain 589824 default / 324608 compact bytes. Median sampled
heap deltas are baseline 22280/13504 B, initial 24224/10824 B, and final 18080/22432 B
(default/compact). These are not allocation totals or peak/retained memory. The
final implementation adds one fixed 219-reference lookup at module initialization;
startup allocation was not measured. This was the sole scheduled validation process
on a shared host. No statistical significance or general speedup claim is made.
