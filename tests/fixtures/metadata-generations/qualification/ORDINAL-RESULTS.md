# Corrected ordinal admission: native and focused results

The corrected reader passed the unchanged eleven-file gate: **51 tests passed,
zero failures, skips or cancellations**. Product revision
`edafb8018be5b75916c8655e9ff1147b38035a24` moves the Module ordinal check before
aggregate map admission. The original failing assertion is preserved; additional
checks prove both rejected ordinal forms leave the complete history unchanged.
The capture and gate ran at tools head
`ddbbbd1925ba1d458cb35c44f6491d3fb2be2a04`, without source changes.

| Phase | UTC start on 2026-10-04 | UTC finish | Exit |
| --- | --- | --- | ---: |
| Native capture | 17:59:10.655 | 17:59:16.503 | 0 |
| External strict provenance | 17:59:37.263 | 17:59:37.611 | 0 |
| Exact twenty-file retention | 17:59:44.205 | 17:59:44.260 | 0 |
| Retained strict provenance | 17:59:49.985 | 17:59:50.272 | 0 |
| Eleven-file Node gate | 17:59:59.283 | 18:00:05.587 | 0 |

`execution-ordinal-first/` retains thirteen exact execution/output files.
`ordinal-gate-retention.json` records their byte counts and SHA-256 hashes, and
the accompanying `.py.txt` preserves the copy operation. The focused output is
the actual Node spec reporter, SHA-256
`5b87a8e05b6cdfd7c35ce6432fd6184cbde58268cc81a8aa93c5dc6a01719e94`.
The original failed 50/51 gate and first native capture remain unchanged in
`execution-first/` and `../reference/`.

The new `../reference-ordinal/native.json` is 422,327 bytes, SHA-256
`d8500a48fe75ae1583d3d8670b1bbf13c38c7befca3a47cbe971cee36ba7b9b9`.
Its 376-file source inventory matches the corrected source. All four native
workload commands completed with exit zero and null signals on SDK 10.0.201,
runtime/reference pack 10.0.5. Their raw stdout/stderr is retained. Existing
toolchain version probes have resolved identities but no retained raw probe
outputs; raw subprocess provenance covers the four workload commands only.

| Replayed facts | Original corpus | Mixed corpus |
| --- | ---: | ---: |
| Generations | 3 | 3 |
| Current raw rows across generations | 77 | 77 |
| Historical row checks | 49 | 48 |
| Entity introduction mappings | 72 | 75 |
| Heap introduction mappings | 137 | 148 |
| Heap values | 105 | 122 |
| Explicit stricter user-string boundaries | 18 | 12 |

User-string boundary checks record deliberate stricter rejections and are not
value-parity claims. The fresh native capture replays the corrected product;
the Node native test separately replays the original reference facts against
that product. All original Portable PDB inputs and first evidence remained
byte-exact before and after every phase.

The reader exposes owned raw metadata generations, introduction mappings and
latest/historical physical rows. This evidence does not establish reconstructed
list ownership, runtime ApplyUpdate, execution of edited methods, browser parity,
other native hosts or source VM/direct CIL/Rust/Wasm targets. Performance has not
run at this retention point; the unchanged prepared cohort is the next phase.
