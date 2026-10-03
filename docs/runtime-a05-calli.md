# Managed indirect calls (T02.6)

Function-pointer provenance is checked across evaluation stacks, argument/local slots and control-flow joins. Every possible target at a `calli` must match its StandAloneSig before execution is accepted. Typed function-pointer arguments, fields and return values carry their declared signature. Unknown native integers cannot silently become verified method targets. Runtime VM ownership and exact signature checks remain in place for host-injected values.

The metadata reader preserves function-pointer instance/calling-convention information. Unmanaged calli produces a structured `NotSupportedException` with member and callingConvention fields, both through verifier rejection and the defensive runtime handler. Managed pointers never expose a host code address.

The native C# fixture uses C# 9 `delegate* managed<int,int>` in a local, field and method parameter, and obtains a function pointer from a factory invoked with `calli`. Tests cover compatible/incompatible branch joins, typed field stores, nested function-pointer results and structured unmanaged rejection. An older test that expected a runtime signature mismatch now correctly expects `IL_CALLI` verification failure. Full qualification remains deferred until E01 is assembled.
