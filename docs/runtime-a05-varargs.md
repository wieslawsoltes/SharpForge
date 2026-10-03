# Managed varargs and typed references (T02.9)

A vararg MethodDef retains its fixed signature. Its MemberRef call site carries a validated sentinel followed by optional types. Optional values are stored after fixed arguments in the callee's argument slots; `frame.varargs` records their canonical type handles and absolute indices. `arglist` produces an owned, frame-scoped RuntimeArgumentHandle. ArgIterator reads those slots through ordinary managed pointers and stops accepting an iterator after End or after the frame returns.

`mkrefany`, `refanyval`, `refanytype`, TypedReference.ToObject/GetTargetType/TargetTypeToken and ArgIterator GetNextArg/GetNextArgType share strict type, ownership and lifetime checks. Typed references retain their backing owner through the normal pointer root tracer. They never expose a native address. Snapshot preflight validates packet shape and iterator position against saved frames rather than the live frame index.

Unmanaged vararg P/Invoke remains unavailable and produces a structured NotSupportedException naming the member. `params` arrays and omitted optional constants are caller-side materialization: no extra runtime calling convention is involved. The native fixture demonstrates all three shapes; frontend binding of params/defaults belongs to the modular source control adapter.

CoreCLR managed-vararg availability differs by platform. Native execution must record the actual host result and supported target; do not classify a platform's vararg rejection as a matching execution result or silently skip it. Native and browser validation are deferred until the complete E01 scope is assembled.
