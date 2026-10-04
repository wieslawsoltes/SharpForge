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

Unmanaged conventions and instance `calli` are explicit `NotSupportedException`
admission failures, with `member`, `callingConvention`, and verifier `issues`.
Generic targets, open signatures, external targets, `ldvirtftn`, `tail.`, `jmp`,
raw function-pointer dereferences, and source-compiler lowering remain outside
this increment. These boundaries do not change existing delegate binding.

Authored coverage is in `tests/a05-managed-calli.test.js`; the retained Roslyn
example is `tests/fixtures/a05-calli/Program.cs`. Local execution and broader
platform qualification are pending the serial validation queue. No performance
or native parity result is claimed by this delivery.
