# Managed static function pointers

The direct CIL engine accepts `calli` with a managed, static, nongeneric
`StandAloneSig` and a matching internal `ldftn` target. This is the first
delivery for [T02.8 / #1359](https://github.com/wieslawsoltes/SharpForge/issues/1359).
It does not complete every function-pointer form in that issue.

Supported pointer storage includes native-int locals, explicitly typed function
pointer locals, arguments, returns, and static or instance fields. Nested
function-pointer results work, including calling a factory through `calli` and
then calling its result. `conv.i` and `conv.u` preserve the existing opaque
carrier; they do not expose a host address. Instance fields use the existing
native-int physical slot and retain their full callable signature for stores.
Optional stack-byte quotas charge function-pointer locals and arguments at the
configured native pointer width, rounded to the existing eight-byte stack slot.
Array or generic types within a function signature do not become MethodTable
names or contribute additional storage bytes. Snapshot preflight uses that same
physical charge.

The verifier follows exact pointer signatures through the evaluation stack,
local and argument assignments, and control-flow joins. All incoming paths must
prove the same signature at an indirect call. Declared pointer arguments,
returns, and field stores also require matching provenance. Address-escaped
local or argument slots are deliberately unproven: indirect writes require a
separate alias analysis before they can feed an admitted `calli`. Handler entry
does not assume a pointer assignment from a protected region.

Signature flags come from the existing lossless metadata AST. The execution
adapter checks flags before using historical inspection strings; public
inspection formatting remains unchanged. The named CIL export
`parseFunctionPointerType(type)` reads that display form and returns its method
signature, or `null` when the spelling is not a function-pointer type. The
parser alone is not proof of executable provenance or calling convention.

Analysis is cold and per verification. It caps estimated instruction/edge times
state-width work at 262,144 and processed state-width work at 1,048,576. State
width uses the verified stack peak, not the method's potentially oversized
`maxstack` header. Exceeding a bound reports `IL_CALLI`; it does not skip proof.

At runtime only pointers produced by this VM are callable. Integer addresses,
copied lookalikes, foreign pointers, and signature mismatches fault before
operands are consumed. Calls use the existing pooled frame, argument-root,
initializer, profiling, and stack-limit paths. Frozen pointer identity survives
the existing in-memory snapshot/restore path. No frame or snapshot fields are
added. Committed metadata edits still require code invalidation and verification
under the existing execution-cache contract.

Unmanaged conventions are explicit `NotSupportedException` admission failures,
with `member`, `callingConvention`, and verifier `issues`. The separate
[managed instance leaf](managed-instance-calli.md) admits ordinary HasThis calls
through evaluation-stack/native-local pointers to internal reference-class bodies.
Generic targets, open signatures, external targets, `ldvirtftn`, `tail.`, `jmp`,
raw function-pointer dereferences, and source-compiler lowering remain outside
this increment. These boundaries do not change existing delegate binding.

All 133 focused tests passed at `a0df70f1`, including managed calli, function
pointer stack quotas, existing stack budgets, delegates, generic calls, generic
struct forwarders, direct struct calls and ABI inventory. This includes the
peer-review repair that sizes callable signatures with array arguments as pointer
storage. The run used Node 24, one worker and a 512 MB old-space limit after
integrating main `4fa3aa4f` and regenerating the merged ABI inventory.

The retained Roslyn example is `tests/fixtures/a05-calli/Program.cs`; it was not
compiled or executed for this leaf. Broad platform qualification remains deferred.
No performance or fresh native parity result is claimed.
