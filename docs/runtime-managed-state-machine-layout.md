# Managed layout for async value state machines

The SDK 8.0.425 qualification assembly in
`tests/fixtures/a05-async/native-sdk8/Qualification.dll` contains auto-layout
value types implementing `System.Runtime.CompilerServices.IAsyncStateMachine`.
After the Roslyn metadata admission repairs, the recorded integration run at
`5cd5b1d05` failed while reserving stack space for `Program+<Work>d__2`.
That reservation used the same layout service as byte-addressed memory and
`sizeof`, so it rejected the managed state before its first instruction.

The runtime now has a separate internal `managedValueLayout` path. It admits
an assembly-owned, closed auto-layout value only when its canonical external
`IAsyncStateMachine` interface resolves both exact slots to verified managed
bodies. The check does not depend on a generated type or method name. An
assembly-local interface with the same display name does not grant admission.

These values retain ordinary immutable aggregate fields. Generic substitution,
field copying, boxed continuation receivers, GC roots and snapshot values use
the existing representation. Canonical field order and alignment provide a
deterministic logical stack charge; they do not describe the CLR's physical
auto layout. Layout work retains the existing field, metadata-row, nesting,
recursion and byte-range limits. Derived managed plans have their own cache,
invalidated with the existing code epoch and type registry.

`valueLayout`, `sizeof`, explicit byte overlays, raw memory, pointer offsets
and `Unsafe.Unbox` retain their existing ABI admission. Warming a managed plan
does not make an auto-layout byte plan available. Unrelated auto-layout structs,
unsupported nested values, readonly/byref-like storage and external opaque
values retain their previous rejection policy. This is support for the existing
managed async interface contract, not a general native auto-layout ABI.

The focused `a05-managed-state-machine-layout` tests use independently assembled,
arbitrarily named generic types and explicit interface implementations. They
cover both integer widths, logical quota boundaries, independent copies and
reference roots, snapshot replay, ABI rejection, missing or unverified interface
slots, a local interface imitation and recursive or unsupported nested fields.
The existing `a05-roslyn-async-admission` test executes and replays the exact
native-qualified DLL at both await points. At integration revision `25a771ed3`,
that test passed with the full native output and all four local/portable replays.
The focused cohort passed 101 of 103 tests, including the existing auto-layout
rejections. Its two failures were the new fixture passing a metadata field token
to the address API, which takes a resolved field index. The fixture now uses
index zero and checks the mutation directly; its rerun remains pending.
