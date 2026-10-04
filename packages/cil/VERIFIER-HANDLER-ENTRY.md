# Reachable exception-entry stack heights

`verifyCilAssembly` rejects a reachable nonempty protected `try` entry unless it
coincides with a catch handler's exception seed. Its `IL_EH_ENTRY` issue identifies
the method, byte offset and incoming `height`. Empty entry and exception-seeded
entry retain successful admission. Consistent branches back to a seeded start
also retain its height, including from later in the same enclosing catch.
A `nop` before the nested try changes this to ordinary fallthrough and fails
unless the exception has already been consumed.

This distinction follows the catch injection and fallthrough rules of
[ECMA-335 sixth edition I.12.4.2.5 and I.12.4.2.8.1](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf)
and the pinned ILVerify observations. The draft originally rejected exception
injection and then matching backwards branches. Native verification disproved
those expectations; all three mismatches are retained in the validation evidence.
Assertions and implementation were corrected together. We do not infer a stricter
branch-entry rule from the fallthrough rule.

The existing height traversal is extracted from the frozen execution-profile
module without changing its transitions. The entry check reuses the byte-offset
and incoming-height indexes after traversal. It does not seed unreachable tries
or add a lookup per instruction. Conflicting heights already emit `IL_STACK`
and prevent successful admission. Catch handlers retain initial height one;
finally/fault handlers retain height zero. Shared catch families produce one
new diagnostic per distinct invalid try entry, capped at 200 emitted issues.

The added pass is O(exception clauses). Zero-height entries allocate nothing;
nonempty entries require at most one candidate per distinct clause start.
Exception-seeded candidates do not consume the diagnostic budget. The extracted
traversal uses one context per assembly and one small result per method; its
existing queue, height map and stack-proof behavior are preserved. An unsuccessful
report cannot produce a verified stack-capacity proof.

This is a reachable height-only admission check. Unreachable tries remain
unvisited. Typed catch/filter entry values, filter execution, general EH control
flow, member access and cross-assembly private access remain separate; #2407
stays open. Standalone `validateExceptionControlFlow` is not newly composed into
this runtime admission API. Existing unsupported-operation diagnostics remain.
No broad engine or platform qualification is claimed.

Eight focused tests and fifteen ILVerify cases passed. They cover
empty/nonempty catch, finally, fault, branch, shared families and nested catch
seeds, delayed fallthrough and matching backwards branches. The existing
conformance catalog's `try-entry-stack` rule and `TryNonEmptyStack` diagnostic
are reused; additional authored PE fixtures exercise the actual admission API.
Corrected serial validation passed all 167 affected tests and local static checks. The existing-path benchmark is
`node packages/cil/tools/benchmark-handler-entry.mjs OUTPUT.json`; it covers
no-handler, catch and finally admission with fixed input hashes. Raw captures, fixed paired measurements and the explicit p95 regression sign-off
are retained in the [evidence](../../tests/fixtures/a03-handler-entry/README.md).
