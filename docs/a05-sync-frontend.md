# Synchronization frontend seam

The compiler and syntax modules are installed by the shared integration owner. They introduce no registry IDs themselves and do not mutate the shared parser/compiler files.

Parser hooks:

1. At the start of `statement`, return `parseSynchronizationStatement(this)` when non-null.
2. Immediately after `prefix` consumes its token, return `parseSynchronizationPrefix(this, token)` when non-null.
3. In the expression suffix loop, before binary operator handling, call `parseSynchronizationTypeArguments(this,left)`; replace left and continue when non-null.

The resulting AST nodes are `Lock {expression,body}`, `RefArgument {modifier,expression}` and a Member's optional `typeArguments` array. The generic suffix only recognizes synchronization owners and only consumes `<...>` when followed by `(`. Relational operators retain their existing grammar.

Install `installSynchronizationCompiler(MethodCompiler)` after the framework and modern compiler installers. The optional `builtinFor(descriptor)` resolver defaults to matching `Builtins[*].synchronization` against the template's complete parameter/return/generic signature. Builtin entries retain the descriptor returned by `syncIntrinsicDefinitions`; their IDs are allocated only by the root registry. Nongeneric closed overloads win over inferred generic overloads. Generic source calls infer their concrete result type from the first byref argument, or validate an explicit method type argument.

`Op.ADDRESS` appends to existing opcode IDs. Operand a uses bits 0–1 for local=0, static=1, field=2, array=3; bit 2 marks a readonly/in address. Operand b is the local/static/field index, or zero for arrays. Local/static push one pointer. Field consumes its object or parent managed pointer and pushes an interior pointer. Array consumes array and index and pushes one pointer. CIL emission maps parameter local slots to ldarga and ordinary local slots to ldloca, with ldsflda/ldflda/ldelema for other kinds. The loader/verifier must preserve the address kind, readonly flag, and exact static element type. The existing T03 address and storage adapter supplies validation and byref lifetimes.

For a generic synchronization builtin, source execution can use the open `!!0` template because the managed pointer carries its actual type. CIL emission must instantiate a genuine MethodSpec with the first argument's byref element type; it must not reinterpret a string reference location as `object&`. Signature analysis therefore propagates the static type through ADDRESS. Reflection, generic user-method syntax and unrelated byref method declarations remain owned by their respective frontend adapters.

Lock evaluates its expression once, initializes a Boolean temporary false, and emits a try/finally containing `Monitor.Enter(object,ref flag)`, the original body, and conditional `Monitor.Exit(object)`. Nested locks use separate temporaries. Returns, breaks and exceptions use the existing EH lowering. The binder rejects value-type lock targets, byref properties/constants/unassigned locals, byref width changes, out/ref mismatches, and writable use of explicit in locations. Receiver and array-index expressions are evaluated once, in argument order. Await within a lock body is diagnosed as CS1996.

The new frontend regression file is `tests/a05-30-frontend.test.js`; it must run with the full E01 gate, not before the shared hooks and opcode adapters exist.
