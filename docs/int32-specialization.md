# Optional Int32 CIL specialization

`new CilVirtualMachine(assembly, {specializeNumericHandlers: true})` selects
Int32 arithmetic and comparison/branch handlers during existing CIL predecode.
The default remains off and runs no numeric category analysis for this option.
Int32 values retain the existing signed JavaScript Number stack representation.

| Capability | Behavior |
| --- | --- |
| Signed/unsigned Int32 | Wrapping and checked arithmetic, shifts, bitwise operations, unary operations and compare/branch forms use preselected handlers. |
| Fault boundaries | Division/remainder by zero and signed MinValue/-1 retain their existing managed faults and messages. |
| Host-edited values | A canonical Int32 guard preserves fallback for floats, native carriers, BigInt, references and noncanonical Numbers. |
| Missing verification proof or unknown type | Keeps the original handler. |
| Other widths and source engines | [Int64 specialization](int64-specialization.md) extends the same option. Native integers, Decimal and source/reloaded-source operations retain ordinary handlers. |

Handlers skip the generic numeric family selection and per-operation string
parsing. They retain the existing `vm.pop`/`vm.push` adapters, including stack
admission, profiler/debugger instruction boundaries and managed exception delivery.
Canonical runtime guards remain necessary because frames are host-visible and
the existing verifier proves stack heights rather than all numeric value types.

The private `numericPlanTypes` helper shares one bounded category analysis per
method/code epoch among numeric decode contributions. It requires an exact
`verifiedStackBound` proof and uses the existing `numericStackTypes` traversal
with a 250,000-unit work allowance. Analysis failure/exhaustion preserves ordinary
execution. The [typed-float option](typed-float-slots.md) consumes the same cached
states when both options are enabled; their dispatch switches remain independent.
Replacement bodies, signatures, locals, reports and option edits
invalidate relevant derived plans; in-place edits require `invalidateExecutionCode`.
The existing frozen decode plan exposes frozen diagnostic `numericHandlerIds`,
such as `add_i4` and `blt_s_i4`, or null when this contribution is disabled/unproven.
No functions, numeric plans or type facts enter snapshots.

This is a partial implementation of #1396. Focused deterministic arithmetic
differentials, checked/unsigned boundaries, direct-CIL loops, host edits,
snapshot replay, budgets and cancellation regressions passed in the serial queue.
All 90 focused Node 24 tests passed at `16907fc9`, including typed-float option
coexistence, verified stack and manual Wasm bridge integration. The required
one-million case qualification, at least 2x loop result, latency/allocation measurements and
broader width/platform qualification remain open. No speedup is claimed.

Run `examples/runtime/int32-specialization.mjs` for the ordinary and specialized
direct-CIL output comparison; it is an example, not a benchmark or native oracle.
