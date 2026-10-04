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
Authored tests cover legal targets, six illegal lexical patterns, all EH kinds,
branch boundaries, cursor expiry, limits and cancellation. A pinned ILVerify
capture and one real CoreCLR tail-call execution are prepared. Their capture,
focused tests, benchmark and checks are pending the serial validation slot.
Source VM, browser and Rust execution support is not claimed.
