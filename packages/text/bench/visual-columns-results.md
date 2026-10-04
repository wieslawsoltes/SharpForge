# Exact visual-column measurements

Command: `node scripts/limited.js node packages/text/bench/visual-columns.js`.
Recorded on Node v24.19.0, Linux x64, AMD EPYC 9V74 80-Core Processor. The host was
shared with other contributors. Grapheme semantics are pinned to Unicode 16.0.0;
the host's optional native Intl segmenter reports Unicode 17.0.

The fixture is 1,048,576 UTF-16 units: an ASCII prefix followed by a tab, a wide
character and a combining cluster. Thirty different positions near the end are
looked up. Each indexed request reuses sparse prefix checkpoints; these samples
are not repeated exact-result memo hits. The baseline scans the complete line
with the public `visualColumnAt` function. Every measured result is compared.

| Operation | Median | p95 | Samples |
| --- | ---: | ---: | ---: |
| Full-prefix `visualColumnAt` | 61.508594 ms | 68.025205 ms | 30 |
| Indexed lookup after prefix indexing | 0.129756 ms | 0.265230 ms | 30 |

The first asynchronous index lookup took 25.040206 ms across 15 cooperative
yields. The index retained 129 sparse checkpoints. Across initial indexing and
all thirty requests, it scanned 1,293,301 units in 316 bounded chunks. The
buffer's lazy full-text snapshot cache remained unmaterialized. See the exact
[raw measurement](visual-columns-results.json).

The separate acceptance fixture in `tests/text-visual-columns.test.js` verifies
an exact column in a **209,715,200-unit (200 MiB ASCII-scale) single line**,
cooperative yielding, at most 4,097 units per text read, bounded checkpoint
storage and subsequent cached/nearby lookups. Another fixture crosses a
2,097,152-mark single combining cluster while retaining only numeric state.
The final eleven-case file completed in 2.428 seconds, with ten passes and one
explicitly skipped Unicode-16-host Intl reference check. The complete official
1,093-case Unicode 16.0 fixture and the existing editor fixtures on the actual
Intl17 host both passed.

These are JavaScript text-model measurements. They do not establish browser
input-to-paint latency, renderer frame timing, fixed CI hardware performance or
operating-system character-cell width.
