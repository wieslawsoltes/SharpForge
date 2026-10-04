# Base-bound generic constrained Object.ToString

Direct CIL accepts `constrained. !n` and `constrained. !!n` followed by
`callvirt System.Object.ToString(): string` when that GenericParam declares one
concrete nongeneric internal base-class TypeDef constraint, such as
`where T : Base`. The closed argument must still be a supported nongeneric
internal reference class. Its owned byref storage must have exactly that closed
type; a Base slot containing Alpha cannot substitute for `ref Alpha`.

The existing reference selector handles the actual receiver, including inherited
overrides, derived overrides, newslot hiding and the Object intrinsic fallback.
It uses the same live object without copying or boxing it. Existing generic-call
admission still validates arity, special constraints and every additional
interface constraint. Null, expired/foreign addresses, unsupported receiver
classes and edited or missing generic contexts retain explicit faults.

The executable verifier checks each canonical generic body once with symbolic
parameters. The declared base bound gives it a precise, bounded set of possible
override bodies using the existing descendant index. It does not inspect
unrelated classes or assume a single MethodSpec is the only possible caller.
Runtime substitution reads the current frame; a cached metadata bound never
contains a substituted class or managed handle.

`ConstrainedReferenceObjectProfile.genericBound(method, typeSpecToken)` returns
the admitted base TypeDef token or null outside this leaf; malformed metadata
can throw CilError. GenericParam and GenericParamConstraint rows are indexed
once on first use. Results are cached by canonical MethodDef and operand token,
within the existing 262,144-entry metadata work budget. Runtime profiles use the
existing code epoch, so restore, unload and metadata replacement invalidate
them. No new VM fields, prefix state or snapshot schema are introduced.

Unconstrained and class-only parameters cannot provide that verification bound.
Interface-only, struct, external (including System.Object-only), generic or
multiple class bounds remain unsupported. Closed generic receiver classes,
generic structs, explicit Object MethodImpl and other Object members remain
outside this slice. General unconstrained Object calls require a wider closed
instantiation reachability design. Source frontend, native/browser and
performance qualification for the original #1357 scope remain open.

Prepared guest-CIL tests cover both parameter kinds, multiple instantiations and
slot behavior, bound-descendant verification, existing generic constraints,
exact owned storage, null/wrong/missing contexts, host GC, snapshot replay across
code epochs, and stop cleanup. Tests, builds and native runs were not executed
during implementation. The root-owned serial queue can run:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-generic-tostring.test.js tests/a05-constrained-reference-tostring.test.js tests/a05-constrained-object-tostring.test.js tests/a05-constrained-generic-reference.test.js tests/a05-constrained-reference-calls.test.js tests/a03-08-prefix-constrained.test.js
```
