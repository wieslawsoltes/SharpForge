# Text-buffer benchmark evidence

Command: `node packages/text/bench/buffer.js`.

Measured on 2026-10-03: Node.js v24.19.0, Linux x64, AMD EPYC 9V74 80-Core Processor. Input: 1,000,000 CRLF-terminated lines, 6,000,000 UTF-16 code units. The operation is one insertion plus a position query. The baseline is the unchanged immutable `SourceText.withChange` path with initialized line starts; the candidate is `TextBuffer` using its persistent indexed tree. Each path warms before collecting samples.

| Region | SourceText median ms | SourceText p95 ms | TextBuffer median ms | TextBuffer p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Start | 22.216898 | 29.094734 | 0.007401 | 0.028864 |
| Middle | 23.480034 | 32.671621 | 0.009253 | 0.025569 |
| End | 24.633915 | 61.675699 | 0.005489 | 0.012879 |

The focused acceptance test independently collected 100 measured edits per region after 20 warmup edits. Its final p95 values were 0.010686 ms, 0.012549 ms and 0.010996 ms, respectively, below the specified 2 ms p95 ceiling on this machine. These numbers describe this runtime/CPU and do not claim a browser rendering measurement or a universal CI latency guarantee.

Correctness qualification: all 55 new text/model tests passed, including 100,000 randomized edits, a 100 MB slice without full-text materialization, random undo/redo, safe-regex oracle fixtures and a process watchdog, randomized diff minimum comparison, and exact merge conflicts. The 126 existing release04/release05 editor/search regression tests also passed. Browser integration and the broader editor latency/memory matrix are tracked by the owning view/benchmark workstreams.
