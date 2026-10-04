# Reachable exception-entry stack heights

`verifyCilAssembly` rejects a reachable protected `try` entry with a nonempty
evaluation stack. Its `IL_EH_ENTRY` issue identifies the method, byte offset and
incoming `height`. This applies to fallthrough, branch entry and a nested try that
starts at a catch handler's initial exception-object stack. Pop or store that
exception before entering the nested try.

The existing height traversal is extracted from the frozen execution-profile
module without changing its transitions. The entry check reuses the byte-offset
and incoming-height indexes after traversal; it does not seed unreachable tries
or add a lookup per instruction. A conflicting later height already emits
`IL_STACK` and prevents successful admission. Catch handlers retain initial
height one; finally/fault handlers retain height zero. Shared catch families
produce one new diagnostic per distinct invalid try entry, capped at 200.

The added pass is O(exception clauses), with no allocation for valid entries and
at most 200 diagnostic-deduplication entries for invalid input. The extracted
traversal uses one context per assembly and one small result per method; its
existing queue, height map and stack-proof behavior are preserved. An unsuccessful
report cannot produce a verified stack-capacity proof.

This is a runtime admission height check, not a full typed verifier. Unreachable
tries remain unvisited. Typed catch/filter entry values, execution of filters,
member access enforcement and cross-assembly private access remain outside this
increment; #2407 stays open. The existing runtime's unsupported-operation
diagnostics are retained. No broad engine or platform qualification is claimed.

Seven focused tests and twelve ILVerify cases are prepared. The latter exercise
empty/nonempty catch, finally, fault, branch, shared-family and nested-catch
entries. The existing conformance catalog's `try-entry-stack` rule and its
`TryNonEmptyStack` native diagnostic are reused as the rule reference; these
additional authored PE fixtures exercise the actual execution admission API.
Validation remains pending the serial slot. The existing-path benchmark is
`node packages/cil/tools/benchmark-handler-entry.mjs OUTPUT.json`; it covers
no-handler, catch and finally admission with fixed input hashes. No performance
or passing-native claim is made before that capture.
