# Source numeric API parity

The source builtin table appends exact descriptors for four `System.BitConverter`
bit reinterpretation methods, `Math.IEEERemainder`, and the `IntPtr.Size` and
`UIntPtr.Size` properties. Existing builtin IDs retain their order.

Binding exposes their actual parameter and return types. CIL emission uses those
same signatures with a marked instruction boundary; reloading accepts an exact
descriptor and canonical re-emission still checks the entire assembly. The
source VM and direct CIL VM invoke the existing numeric implementation registry.
Pointer size is evaluated against the selected VM ABI at execution time.

Focused regressions cover Single rounding, negative zero, round-trip bit
reinterpretation, IEEE ties to even, non-finite remainder, both pointer widths,
ordinary overload diagnostics, readonly properties, and malformed signatures or
instruction markers. The native numeric oracle separately checks the same API
paths against retained CLR output; retained output is not a fresh CLR run.
