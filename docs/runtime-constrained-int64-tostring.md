# Concrete constrained Int64 and UInt64 ToString

Direct CIL supports `constrained. System.Int64` and `constrained. System.UInt64`
TypeRefs followed by the ordinary instance `System.Object.ToString(): string`
MemberRef. This extends the [Int32 path](runtime-constrained-int32-tostring.md)
to exactly three concrete integer types. It does not broaden generic parameter
or TypeSpec admission.

Both 64-bit types use the existing canonical signed 64-bit BigInt storage. The
declared type selects the unchanged `long` or `ulong` formatter: stored `-1n`
produces `-1` for Int64 and `18446744073709551615` for UInt64. Values never pass
through a JavaScript Number, and the configured native ABI width does not change
their interpretation. Number payloads, out-of-range BigInts, tagged native
integers and uninitialized slots remain invalid.

The existing owned-address checks require the exact declared MethodTable, so an
Int64 address cannot satisfy a UInt64 constraint or vice versa. Locals,
arguments, static fields, struct fields, arrays and existing box interiors share
that path. Foreign addresses, expired frames, stale heap owners and readonly
receivers retain their existing faults. There is no receiver boxing or storage
write. Formatting and string allocation keep the original address on the stack
and temporarily root its heap owner; only success replaces it with the result.

`ConstrainedObjectProfile.primitive(typeToken, descriptor)` returns a cached,
frozen `{name, format}` plan or `null`. It accepts only the three builtin TypeRef
names and reuses the existing exact Object.ToString declaration validation.
Invalid declarations retain that validator's error behavior. The existing
`int32(typeToken, descriptor)` boolean query remains Int32-only, including its
early rejection of other types. Runtime plans remain metadata-only and follow
the existing execution-code epoch; no snapshot fields or ABI carriers change.

Other primitives, generic constrained parameters, readonly calls,
GetHashCode/Equals and compiler lowering are outside this increment. The full
acceptance of #1357 remains open. Native/browser parity and performance have not
been measured for this leaf.

The new guest-CIL fixtures cover exact bounds and values above Number precision
under both ABI widths, all admitted storage locations, invalid receivers and
payloads, collection during formatting, allocation failure, snapshot replay,
stop cleanup and the preserved metadata helper contract. The two older negative
tests now use Single/Double instead of newly supported Int64. They continue
asserting rejection for unsupported primitive constraints.

Tests are authored, not run. No tests, builds, checks, native processes or
benchmarks were executed during implementation. The root agent owns the serial
validation slot; the focused command is:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-int64-tostring.test.js tests/a05-constrained-int32-tostring.test.js tests/a05-constrained-object-tostring.test.js tests/a05-constrained-reference-tostring.test.js tests/a05-constrained-generic-value.test.js tests/a03-08-prefix-constrained.test.js
```
