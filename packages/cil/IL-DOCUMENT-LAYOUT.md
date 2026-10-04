# Explicit branch layout for editable IL documents

`assembleILDocument(text, { relaxBranches: true })` adapts branch widths after text
edits through `CilWriter.finishWithLayout`. The existing default keeps the exact
requested branch forms and rejects an out-of-range short branch. The new option
selects the shortest valid form for each short-capable branch, including `leave`.
Switch destinations remain symbolic until layout finishes.

Each method's existing `.eh` try/handler/filter labels and implicit end-of-method
label are translated through the returned offset map. Header flags, maxstack and
local-signature tokens retain the document values. The existing assembler still
requires every original method body, uses the metadata/resource scaffold, and
invalidates its existing signatures and custom debug maps as before.

This is the SharpForge IL dialect, not Microsoft ilasm syntax. Quoted ldstr support
is documented in IL-DOCUMENT-STRINGS.md. Layout does not add general metadata rows,
infer stack sizes, verify prefix/exception transfer
legality, generate Portable PDB mappings, or activate default compiler relaxation.
The new layout path inherits its 16 MiB / one-million instruction and target limits.
Unsupported labels and invalid options produce CilError. The assembler remains a
bounded synchronous whole-document operation.

Validation: all five document-layout tests and 56 existing managed-IL compatibility
tests pass. Native .NET 10.0.5 executes the four edited methods with results
Main=42, Catch=42, Filter=43 and Switch=44. SDK 10.0.201 on macOS ARM64 builds the
oracle with zero warnings/errors. Required check passes (2551 syntax / 2547 static
modules, zero errors); structure reports no findings in this increment's files.
Direct CIL VM execution covers branch/catch/switch;
filter execution uses the native oracle because that VM capability remains separate.
#2393 and inherited A00 qualification remain open for other IL-document work.

The existing exact-header body encoder remains local to this extraction because
writeMethodBody intentionally forces initLocals and a minimum maxStack. Reusing
those defaults would change existing editable-document semantics. Branch layout
itself uses the shared writer API, with no separate relocation algorithm.

Paired measurements: Apple M3 Pro / Mac15,6, macOS ARM64, Node 24.21.0, 2 warmups
plus 7 samples. Baseline uses exact il-document.js at ead84e6f; the other package
sources are held fixed. The documents contain 1000/5000 NOPs and 18135/83595
characters. This was the sole scheduled validation process on a shared host.

| Mode | NOPs | Median ms | p95 ms | Median sampled heap delta |
| --- | ---: | ---: | ---: | ---: |
| Before default | 1000 | 1.841875 | 2.014125 | 2296112 B |
| After default | 1000 | 1.814000 | 2.161417 | 2199640 B |
| Before default | 5000 | 5.080417 | 10.834292 | 8917816 B |
| After default | 5000 | 5.131583 | 5.264375 | 8393376 B |
| Explicit layout | 1000 | 2.394666 | 2.716833 | 2652264 B |
| Explicit layout | 5000 | 6.766291 | 8.350084 | 11359880 B |

Integration review accepts the small-case default p95 increase of 0.147292 ms
(+7.31%) for the extracted bounded assembly/layout capability. All raw controls
and opt-in samples are in `benchmarks/il-document-layout.json`. Sampled heap deltas
are not allocation totals or peak/retained memory. No statistical significance or
general speedup claim is made. Run
`node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-il-document-layout.mjs LABEL default|layout OUTPUT.json`.
