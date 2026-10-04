# Legacy source Math.Min/Max parity

Released source wire IDs 3/4 now use the same floating selection predicate as
the [CIL operand-selection fix](floating-math-extrema.md). Previously their
JavaScript Math call could replace a selected NaN with a different NaN encoding.
Both paths now retain the selected input's NaN bits and choose negative zero for
Min or positive zero for Max when zero signs differ.

The source adapter returns a primitive Number, preserving the existing Int32
and Double wire carrier. Its raw-Number helper creates no tagged float wrappers.
Existing `vm.value` unwrapping remains in place; non-Number inputs still use the
same Math fallback, including its BigInt TypeError behavior. The typed `.math`
dispatch path, signatures, wire IDs and canonical emission/reload are unchanged.

The shared predicate follows pinned .NET 10.0.5
[Math.Min/Max](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs).
No additional algorithm, overload, binder rule or numeric conversion is added.
This does not expand signaling-NaN guarantees across host architectures.

`tests/a05-source-legacy-math-extrema.test.js` authors exact selected quiet-NaN
payload cases at the source builtin seam, primitive Int32/Double return and
fallback regressions, and compiled source/reloaded/direct-CIL checks that the
result retains the input NaN bits. Independently built old wire images retain
their mappings and finite results. Validation and platform/performance evidence
remain staged; no new native capture or measured performance result is claimed.
