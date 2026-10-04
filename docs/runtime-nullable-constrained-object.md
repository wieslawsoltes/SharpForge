# Nullable constrained Object calls

The SDK 8 cell of [native qualification run 37219653301](https://github.com/wieslawsoltes/SharpForge/actions/runs/37219653301)
exposed a call shape missing from the existing Nullable tests. Roslyn emitted
`constrained. Nullable<T>` followed by `callvirt System.Object.ToString` at ten
sites. The prior tests emitted direct Nullable member calls. Native .NET passed
the fixture; A05 rejected its constrained calls during verification.

The captured input was produced by SDK 8.0.425 for `net8.0` at product revision
`e09324d3e83d742d47eb39b8f0482c38dc0f8756`. Its DLL SHA-256 is
`4a537aedd32fbb12e52ae974e0646ef5acb110b624bc1c96e67ffaf1ebd4b034`.
The artifact retains the original DLL, source, native stdout and failed VM report.
Static inspection confirmed Int32, Boolean, Char, UInt32, UInt64 and user-struct
Nullable receivers. Roslyn's `in` receiver uses an explicit local copy before
the constrained call; the writable receiver uses the original local address.

The verifier now recognizes the exact ordinary Object `ToString`, `Equals(object)`
and `GetHashCode` slots on supported Nullable instantiations. Underlying managed
overrides and their initializers enter the existing reachable-body proof.
Symbolic Nullable arguments still require a valid declaring generic context;
execution resolves and validates the closed type and owned receiver address.
Unrelated overloads and invalid reference-type Nullable arguments remain rejected.

Execution reuses the existing Nullable payload adapter. Empty values return an
empty string or zero hash, and equal only null. Present equality follows the
[Nullable.Equals contract](https://learn.microsoft.com/en-us/dotnet/api/system.nullable-1.equals):
null is unequal, and other objects reach the underlying value's equality method.
Default value equality retains exact boxed-type identity. Managed overrides use
the original writable payload address; readonly receivers use a defensive copy.
Calls suspend through ordinary managed frames, retaining existing GC roots,
snapshot representation and return validation. No Nullable wrapper box is created.

`tests/a05-nullable-constrained-object.test.js` authors the observed prefix/call
patterns through public CIL metadata APIs. It covers absence, boxed identity,
primitive formatting, mutating overrides, copied receivers, collection, snapshot
replay, symbolic generic contexts and invalid address/declaration controls.
The recorded native DLL remains an independent replay target. This batch has
static checks only until the coordinated serial validation slot runs; it does
not claim a new native or VM pass merely from the repair.
