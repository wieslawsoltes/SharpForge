# CIL array and memory execution profile

The managed execution profile resolves array and memory intrinsics by their complete
CLI signature. Rank, element type, staticness, parameter widths, generic arity,
return type, and managed calling convention all participate in admission. Unknown
custom modifiers do not silently match an overload.

Rectangular arrays expose their CLI `.ctor`, `Get`, `Set`, and byref `Address`
pseudo-methods. Rank-one MD arrays (`T[*]`) remain distinct from vectors (`T[]`),
and encoded lower bounds remain part of their type spelling. The supported
reflection APIs are `Array.CreateInstance`, dimension and length queries, and
the exact `GetValue`/`SetValue` index overloads. Array runtime contracts cover
`InitializeArray`, `Clone`, `Copy`, `Clear`, `Resize<T>`, and `IndexOf<T>`.

The memory contracts cover supported `Span<T>` and `ReadOnlySpan<T>` constructors,
indexing, slicing, length queries, array conversion, and pinnable references;
`Unsafe.As<TFrom,TTo>(ref TFrom)`; `Unsafe.Unbox<T>(object)`; and the byte-array
BitConverter overloads. `Unsafe.Unbox<T>` requires a closed non-nullable value type
with an admitted layout and returns the existing owned mutable box interior.
It shares ordinary unboxing's exact struct identity, compatible enum-underlying
types, null/type faults, managed roots and snapshot behavior. It does not create
an unchecked raw-memory alias or change the box's runtime type.
ReadOnlySpan's recognized readonly return modifier retains readonly receiver
semantics. Conversion to writable Span is not inferred from a readonly signature.
Existing Nullable and scalar BitConverter handlers keep their established carrier
and identity behavior.

These contracts select an implementation. They do not replace the bounded CLI
stack analysis or the independent typed verifier. Runtime allocation, lifetime,
ownership, covariance, layout, and bounds checks still apply after admission.
The signature matrix is covered by `tests/a05-memory-intrinsic-profile.test.js`.

`localloc`, `cpblk`, and `initblk` now participate in the same bounded stack-height
analysis as existing instructions. Both block operations consume three values.
The memory-prefix validators retain exact alignment operands, duplicate rejection,
legal targets, branch boundaries, and exception-region boundaries. `readonly.`
requires `ldelema` or an exact array `Address` MemberRef. Prefix offsets stay flat
for debugger stepping and instruction accounting.

Pinned storage is admitted only at local declaration boundaries. Native-pointer
signatures and closed rectangular array signatures retain their original metadata
spelling. Generic aggregate method arguments and owners use the runtime's closed
layout checks instead of the old sizeof-only or constrained-forwarder restrictions;
generic arity, variable bounds, interface constraints, unsupported layouts, and
readonly/lifetime checks remain enforced by their existing owners. The independent
typed verifier continues to report only the transfers it can prove.

`tests/a05-memory-execution-profile.test.js` exercises the admission and rejection
boundaries. Existing sizeof-only and constrained-forwarder predicate tests still
check their narrow classifications independently from general storage admission.
