# Verified CIL evaluation stacks (SF-A05-T09.3, #1401)

Direct CIL frames already reserve stack storage from their maxstack header. This
increment also verifies incoming heights (including the exception on catch entry),
rejects malformed headers, and records the actual reachable peak of each method.
A canonical verified body uses a push path without the global bound comparison.
Pop keeps its existing underflow diagnostic.

`maxStackValues` remains a per-frame host quota, default65536. It must be a
nonnegative safe integer. Before allocating execution frames, the runtime admits
all reachable verified methods against their actual peak. An oversized header does
not cause rejection if its reachable peak fits. The pool reserves at most
`min(maxstack, maxStackValues)` evaluation slots. A zero limit admits a void method
whose actual peak is zero. A quota violation throws ExecutionLimitException at
admission rather than after executing a prefix of the program. Host options remain
owned by the VM; change resource limits before starting or admitting execution.

The CIL package exposes `verifiedStackBound(inspector, report, method)`, returning
a frozen `{capacity, peak}` or null. Proof is private to a successful verification;
a copied report or reused MethodDef token is insufficient. It includes semantic
instruction/handler operands and permits concrete generic signatures that share
the canonical body. Cold proof comparison is O(instructions + handlers), cached
per method/code epoch. Instruction entry checks frame/body identities in O(1).

Existing inspector/body editing behavior remains supported. Replacement or an
explicitly invalidated in-place edit uses the original checked push fallback when
its previous proof is stale. Re-running `verifyCilAssembly` and assigning the new
report enables the optimized path again. Code edits must retain the existing
explicit invalidation contract. Active and parked snapshot stacks are preflighted
before restore mutation; derived admissions are not serialized. Cancellation and
frame pooling retain their existing ownership rules.

Capability: direct CIL verified push bounds, including snapshots and cooperative
contexts. The source VM, source reload execution, byte stack budgets and precise
root liveness are unchanged. `tests/a05-09-verified-stack.test.js` supplies runnable
independent CLI fixtures for headers, host limits, stale proofs, fallback, snapshots
and parked cancellation. Existing decode/PIC expectations are retained.

No test, build, native, browser or benchmark execution was performed while
preparing this batch. Root's serial qualification queue must record exact tool
versions and cold/warm/p95/p99/allocation measurements before any performance
claim or closure of the parent task. No measured speedup is claimed here.
