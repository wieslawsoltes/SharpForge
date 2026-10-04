# Reachable exception-entry stack heights

`verifyCilAssembly` rejects a reachable ordinary arrival at a protected `try`
entry with a nonempty evaluation stack. Its `IL_EH_ENTRY` issue identifies the
method, byte offset and incoming `height`. This applies to fallthrough and branch
entry. Exception injection at a catch handler that coincides with a nested try
start remains valid; an ordinary nonempty reentry to that same instruction fails.
This distinction follows ECMA-335 sixth edition I.12.4.2.5 and I.12.4.2.8.1,
including the nested catch/try example in I.12.4.2.8.2.8:
https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf

The existing height traversal is extracted from the frozen execution-profile
module without changing its transitions. The entry check reuses the byte-offset
and incoming-height indexes after traversal; it does not seed unreachable tries
or add a lookup per instruction to the height traversal. A conflicting later height already emits
`IL_STACK` and prevents successful admission. Catch handlers retain initial
height one; finally/fault handlers retain height zero. Shared catch families
produce one new diagnostic per distinct invalid try entry, capped at 200.

The usual added pass is O(exception clauses), with no allocation for zero-height
try entries. Nonempty try starts allocate at most one candidate per distinct
clause start. When a start coincides with a catch seed, one additional pass over
reachable instructions and their outgoing edges distinguishes ordinary arrivals.
The overall bound is O(clauses + instructions + edges), without scanning clauses
per instruction. The diagnostic cap applies to emitted issues, so valid seeded
entries cannot consume it. The extracted
traversal uses one context per assembly and one small result per method; its
existing queue, height map and stack-proof behavior are preserved. An unsuccessful
report cannot produce a verified stack-capacity proof.

This is a runtime admission height check, not a full typed verifier. Unreachable
tries remain unvisited. Typed catch/filter entry values, execution of filters,
member access enforcement and cross-assembly private access remain outside this
increment; #2407 stays open. The existing runtime's unsupported-operation
diagnostics are retained. No broad engine or platform qualification is claimed.

Eight focused tests and fourteen ILVerify cases are prepared. The latter exercise
empty/nonempty catch, finally, fault, branch, shared-family and nested-catch
entries, including delayed fallthrough and backward reentry after a catch seed. The existing conformance catalog's `try-entry-stack` rule and its
`TryNonEmptyStack` native diagnostic are reused as the rule reference; these
additional authored PE fixtures exercise the actual execution admission API.
The initial native capture disproved the draft's blanket rejection of a nested
catch seed. That raw mismatch is retained; the assertion and implementation were
corrected together, with two ordinary-arrival regressions added. The corrected
serial validation is pending. The existing-path benchmark is
`node packages/cil/tools/benchmark-handler-entry.mjs OUTPUT.json`; it covers
no-handler, catch and finally admission with fixed input hashes. No performance
or passing-native claim is made before that capture.
