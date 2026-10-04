# T02.3 closed generic calls (#1356)

This increment executes internal generic classes and methods through real TypeSpec,
MemberRef and MethodSpec metadata. It substitutes signatures, locals, instance and
static fields, array elements, box/unbox.any, initobj and typeof(T) in the current
frame. Nested reference instances, primitive/enum/Decimal arguments, virtual overrides and
explicit implementations of multiple closed interfaces retain separate identities.
The existing MethodTable registry, field cache, declaration slots and PIC remain
the runtime type/dispatch machinery.

`resolveExecutionMethod` is the shared CIL descriptor API. Its optional context is
`{ownerToken, genericIdentity, typeArguments, methodArguments}`; the optional raw
argument is an unsubstituted descriptor from the token cache. It returns the
resolved MethodDef, concrete signature, closed owner and argument names.
`normalizeCallType`, `substituteCallType`, `instantiateSignature`,
`callSignatureKey` and `methodGenericParameters` expose the same normalization and
metadata rules used by verification and execution. `resolveExecutionField` also
accepts an optional fourth method-argument array. Invalid arity or ambiguous
internal members throw CilError. Verification checks symbolic variable bounds and
retains the existing opcode, stack-height and external-member checks.

The runtime cache keys concrete methods by MethodDef and canonical MethodTable
handles. Method signatures and locals are separate; instruction bodies remain
shared. Ordinary methods retain their original identity. Cache entries, resolved
call descriptors and selected declaring owners are derived code-epoch state,
cleared together with token/PIC caches on edit, assembly replacement, stop and
snapshot restore. A suspended frame retains its concrete method and context.
`maxGenericInstantiations` bounds the derived instantiation cache (default 100000).
Generic constraints are checked before entering instantiated methods.

T02.3 remains open for user aggregate value arguments (T03 storage/layout), generic
function-pointer/delegate binding, and external generic framework implementation.
Aggregate arguments and unregistered external arguments fault explicitly; external
members and generic delegate pointers retain verifier diagnostics. The existing
primitive-only sizeof/cpobj/unbox opcode admission remains unchanged. This is a
runtime metadata increment; it does not add source compiler generic syntax support.

Focused files: `a05-02-generic-calls.test.js` and
`a05-02-generic-dispatch.test.js`. The independent fixture builder writes CLI
metadata without the source compiler. `fixtures/a05/generic-calls` supplies a
net10.0 Roslyn/native differential input and expected output; reference tool version
and measured results will be recorded when the root's serial queue runs it.
Serial focused validation on Node 24.21.0 (one worker, 512 MiB) initially passed
60 of 62 cases. The Decimal initobj admission regression and an external fixture
that accidentally selected an already registered collection were corrected; all
27 affected dispatch/Decimal cases then passed, including a new generic Decimal
default regression. Browser/native/Wasm and performance qualification remain pending.
