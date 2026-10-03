# Closed generic execution (T02.3)

`execution/generics.js` owns each VM's explicit instantiation cache. Its nested maps use a MethodDef token and canonical MethodTable objects for the declaring closed type and method arguments. Aliases such as `int` and `System.Int32` resolve to the same identity. Concrete signatures, locals, frame arguments and field layouts retain their own generic context, while every instantiated method points to the assembly's canonical IL instruction array. Reference instantiations therefore share code without sharing mutable locals or static storage.

The default cache bound is 100,000 entries, configurable with `maxGenericInstantiations`. Metadata-generation replacement invalidates the cache. Method/type constraints, complete arity, closed arguments and declaring owner identity are checked before an entry is admitted.

Portable snapshot integration uses `captureGenericInstantiations(vm)`, `validateGenericInstantiations(vm, tuples)` and `restoreGenericInstantiations(vm, tuples)`. Each tuple is `[methodToken, closedOwnerNameOrNull, methodArgumentNames]`; it contains no live table, cache node or JavaScript function. Preflight builds a temporary cache and preserves the live cache on rejection. Restoration installs a complete prepared cache before frame methods are rehydrated through `instantiatedMethod`.

The native fixture in `tests/fixtures/a05-generics` exercises a List-like generic class, value and reference generic methods, a nested Dictionary/List shape, `default(T)` and `typeof(T)`. Focused tests also cover aliases, malformed tuples, constraints, cache bounds and canonical body sharing. Validation is deferred until the complete E01 scope is assembled; no passing or performance result is claimed here.
