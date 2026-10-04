# Tail-prefix lexical validation

`validateTailPrefixes(code, handlers?, options?)` checks the lexical `tail.`
contract and returns caller-owned decoded instruction groups. Each tail prefix
must target `call`, `callvirt` or `calli`, followed immediately by an unprefixed
`ret`. Duplicate tails are rejected. A branch may target the first prefix or the
following `ret`, but cannot skip any prefix in a group.

The existing exception-region tree validates handler boundaries and nesting.
Its instruction-order cursor and the existing tail placement rule exclude tails
from every protected region, filter and handler. The old placement API keeps its
behavior and diagnostics. Other prefix semantics and general EH transfers are
separate validators; supplying a different prefix does not verify its legality.

`tailPrefixDiagnosticCatalog` defines CILPT0001 (duplicate), CILPT0002 (target)
and CILPT0003 (following return). These failures carry the offending prefix's
byte `offset`, target name and opcode `targetOffset`. EH exclusion retains
CILCF0006; tree and structural grouping failures retain their existing errors.

This API deliberately does not resolve signatures, count call arguments, verify
return assignability or track managed-pointer lifetimes. In particular, a tail
that passes a local address can satisfy these lexical rules while being unsafe.
Those typed checks remain open on #2410; success is not full tail verifiability
and does not automatically activate this validator in an execution engine.

Limits and cancellation come from the shared tree/group decoders: 16 MiB code,
one million instructions, 100,000 clauses, depth 1,024, 64 prefixes per group.
Options may lower these bounds. Construction and scanning cost
O(code bytes + instructions + prefixes + clauses log(clauses + 1)), with bounded
decoded records, a boundary bitmap and O(clauses) tree/cursor storage. No new
records or ancestry searches are allocated per tail after decoding. The tree's
boundary decode and the separate group decode are each performed once.

Reference: [ECMA-335, sixth edition, III.2.4 and I.12.4.2.8](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
The scheduled local run passed all 65 focused tail/group/EH tests, including
legal targets, six illegal lexical patterns, all EH kinds, branch boundaries,
cursor expiry, limits and cancellation. Pinned ILVerify 10.0.5 agrees with all
six native observations (one accepted, five rejected); the CoreCLR entry point
tail-called its target and returned 42. Raw output and source/tool/image/reference
hashes are retained in `tests/fixtures/a03-prefix-tail/native.json`. SDK 10.0.201,
CoreCLR 10.0.5, macOS ARM64; no new native compiler build was needed.
Source VM, browser and Rust execution support is not claimed.

All jobs ran sequentially through the limiter with both concurrency settings 1.
Static/manifests checks passed: 2,760 syntax modules and 2,756 static modules,
zero errors. Structure reported 270 existing findings and none in changed files.

New-API measurements on Node 24.21.0 / Apple M3 Pro, shared host: 3 warmups and
9 chronological GC-separated samples, one validation per sample. Median/p95 ms:
1,000 tail calls 1.737375/2.603958; 5,000 calls 4.981167/6.507833.
[Raw samples and commands](benchmarks/prefix-tail.json) retain heap deltas, which
are not allocations, retained memory or peak RSS. The synthetic workload is
lexical-only. No historical-equivalent or general speedup claim is made. The
existing placement handler's body and dispatch behavior are unchanged; it is
only renamed and exported internally for reuse.
