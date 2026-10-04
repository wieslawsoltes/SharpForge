# Numeric decode contribution — SF-A05-T08.2

`specializeNumericHandlers(vm, method, plan)` refines the T07 decode plan before it is frozen. It consumes the existing immutable instructions and offset map, replaces proven numeric entries in `plan.handlers`, and attaches stable diagnostic IDs plus conservative stack-category states. Setting `specializeNumericHandlers:false` retains generic handlers.

A forward dataflow pass starts with verified method and handler entry shapes. Constants, normalized local/argument/field loads, conversions and normalized managed returns establish categories. Differing categories at a join become unknown. External calls, unmanaged addresses, unresolved generic facts and unsupported producers cannot authorize a numeric fast handler. This analysis is an optimization over the verifier's accepted code; it does not broaden verifier acceptance.

The contribution specializes all Int32 arithmetic including checked signed/unsigned
operations and masked shifts, common unchecked Int64 arithmetic, Single/Double
arithmetic, and typed compare branches. Native integers retain their exact generic
helpers. Float results use immutable wrappers by default; `typedNumericStack:true`
selects raw planes. `smallLongFastPath:true` selects guarded Number/BigInt handlers
for the complete Int64 operation set. Scalar operations avoid category dispatch,
and checked Int32 arithmetic avoids BigInt because any in-range Int32/UInt32 product
is exactly representable by Number. Signed minimum-value remainder by -1 retains
the pinned CLR overflow fault, including in specialized handlers.

The focused suite includes one million deterministic specialized/generic Int32 comparisons, managed fault boundaries, signed-zero/NaN compare branches and incompatible join fallback. No test or performance measurement has been executed before E02 assembly. The 2x loop-throughput target remains unqualified.
