# Byref-only generic struct forwarding

Direct CIL supports one additional method-instantiation pattern:
`static int Apply<T>(ref T value, int delta) => value.Bump(delta)`, where the
selected member is declared by a nongeneric internal interface and the actual
`T` is an admitted nongeneric, reference-free sequential user struct.

The canonical static method must have one generic method parameter (`!!0`), no generic
declaring type, no locals or exception regions, first argument `!!0&`, and no
generic variables elsewhere in its signature. Its body loads arguments in order,
executes `constrained. !!0` / `callvirt`, and returns the member's exact result.
Extra `nop` instructions retain debugger offsets; none may split the prefix.
The remaining parameters and return type must match the interface declaration.
By-value or nested generic signatures, copied generic locals, boxing, recursion,
extra operations and other bodies produce an explicit unsupported diagnostic.

The named CIL export `isByrefStructForwarder(inspector, methodToken)` implements
this metadata-only, linear admission predicate. It returns false for unsupported
shapes and retains inspector errors for malformed metadata. Verification and
runtime instantiation both use it. Runtime results are cached by method token
inside the existing execution-code epoch, so restore, Hot Reload and independent
VMs cannot reuse another body's admission. Warm constrained dispatch does not
rescan the body. No mutable prefix or new snapshot field is introduced.

Existing GenericParam constraints still apply. Runtime instantiation reuses the
ordinary value-storage admission for layout, managed-reference, readonly and
ref-like rejection, without allocating a default struct. The interface call then
uses the exact owned byref, existing verified slot resolution, initialization
retry, and direct struct call. It preserves mutations to the original slot and
does not allocate a receiver box. Explicit interface implementations use the
same path. Existing scalar and reference generic instantiations are unchanged.

This is a bounded part of #1357. Generic struct layouts, generic declaring types
holding these values, general aggregate generic bodies, Object fallback, DIM,
readonly struct receivers and source frontend lowering remain unsupported.
The ordinary snapshot contract is unchanged; portable snapshots and platform
qualification are not claimed by this leaf.

Prepared guest-CIL tests cover both slot styles, separate closed structs, value
copies, array/field/box interiors, GC, prefix/callee snapshots, stop cleanup,
initializer retry, invalid addresses, constraint violations and storage/body
rejection. All 87 focused tests below passed at `7e5fbdb5`, after integrating
the actual merged generic-reference parent. The serial run used Node 24, one
worker and a 512 MB old-space limit. Native and performance qualification remain
deferred. The completed command was:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-generic-value.test.js tests/a05-constrained-generic-reference.test.js tests/a05-constrained-interface-calls.test.js tests/a05-02-generic-calls.test.js tests/a05-value-instance-calls.test.js
```
