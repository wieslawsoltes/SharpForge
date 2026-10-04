# Managed instance calli

Direct CIL supports default managed `HasThis` StandAloneSig calls to verified
nongeneric internal reference-class `ldftn` targets. The stack contains the
receiver, declared arguments and then the opaque pointer. `calli` invokes that
exact method body through the ordinary rooted, pooled VM call path. A pointer to
a base virtual method still invokes the base body on a compatible derived
object; it does not perform virtual redispatch.

This leaf supports pointers on the evaluation stack and in native-int locals,
including compatible control-flow joins. Existing managed static typed-pointer
storage, parameters, results and fields retain their behavior. A subsequent
[typed-local increment](runtime-typed-instance-pointer-locals.md) admits direct
ordinary instance-pointer locals. Instance typed parameters, results and fields
remain rejected before inspection formatting can erase HasThis. ExplicitThis,
varargs and unmanaged conventions are rejected explicitly.

`InstanceCalliTargets(inspector).accepts(methodDefToken)` is a shared metadata
predicate. It accepts ordinary HasThis bodies on nongeneric internal classes;
it rejects interface/value/generic owners, generic methods, abstract or external
targets, constructors and ExplicitThis. It indexes GenericParam owners once and
caches a boolean per known MethodDef; TypeDef row indexing is constant-time.
The verifier only gives admitted instance targets callable signature provenance.
Unsupported instance ldftn targets remain usable by existing delegate binding
where that binding already allows them; this leaf does not broaden delegates.
Recreate the predicate after metadata changes. Runtime instances belong to the
existing execution epoch and contain no receiver handles.

Before removing any operands, runtime admission checks the same-VM pointer brand,
verified target, exact signature, argument count and receiver. The receiver must
be an original allocation handle from this heap, live at its recorded generation,
and an assignable nongeneric internal reference-class object. Null throws the
existing managed NullReferenceException. Foreign/copied handles and incompatible
objects are rejected; stale handles retain InvalidReferenceException. The
[weak ownership prerequisite](heap-reference-ownership.md) leaves coordinate-based
heap lookup behavior and handle shapes unchanged.

Normal frame limits, byte quotas, initialization rules, exception unwinding,
root scanning, debugger offsets and method events continue through vm.call.
In-memory snapshots preserve frozen pointer and receiver identities; restore
invalidates derived metadata caches. No snapshot fields or dispatch loop are
added. Typed instance-pointer parameters/results/fields, ldvirtftn, generic/value/interface targets,
generic receiver objects, external targets, tail., jmp and source-compiler
lowering remain outside this increment of #1359. Portable snapshots, native and
browser parity, and performance qualification remain pending.

Focused guest fixtures were authored for exact base-body invocation, native
locals at both ABIs, joins, signature/admission failures, foreign pointer and
receiver collisions, GC callbacks, snapshots/stop, initialization, and frame/byte
quotas. The former blanket instance-call rejection test now checks the original
malformed case as a static-versus-instance signature mismatch. Tests, builds and
native runs were not executed during implementation; root owns the serial queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-managed-instance-calli.test.js tests/a05-managed-calli.test.js tests/a05-calli-stack-byte-budget.test.js tests/a05-heap-reference-ownership.test.js tests/a05-delegate-targets.test.js tests/a05-seams-snapshot.test.js
```
