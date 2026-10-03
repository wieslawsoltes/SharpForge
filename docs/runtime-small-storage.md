# Small integer storage in direct CIL

This T01 increment gives `sbyte`, `byte`, `short`, `ushort`, `char` and `bool`
one truncation helper. Calls normalize declared arguments before entering the
callee. Managed-pointer writes normalize the physical destination, including
locals, arguments, instance/static fields, array elements and boxed primitives.
An unsigned byte slot stores `255` after `stind.i1` writes `-1`; `ldind.i1`
still reads `-1` while `ldind.u1` reads `255`. Snapshots retain the normalized slot.

The bytecode entry point exports `smallInteger(value, type, context?)` and
`smallIntegerIndirect(value, suffix, context?)`. They accept integer Numbers or
BigInts, return an Int32 Number after truncation/sign extension, and reject other
values with `InvalidProgramException`. Full `System.*` primitive names are
accepted. The optional `context.fault(name, message)` supplies the error factory.
`bool` storage retains its CLI one-byte pattern; the existing Boolean display
adapter interprets zero/nonzero. The runtime storage adapter also accepts host
Boolean values explicitly.

UInt32 keeps a signed Int32 evaluation-stack pattern. Host marshaling accepts
only `0..4294967295`; declared UInt32 output and return values recover unsigned
meaning. Focused tests cover both high-bit boundaries, boxing and text output.
UInt32 arithmetic/comparison helpers are a separate T01.3 increment. This slice
does not claim completion of that issue or of broader source numeric modes.

| Surface | Status |
| --- | --- |
| Direct CIL small storage and UInt32 round trips | Implemented; focused tests prepared |
| Shared pure small-integer helpers | Exported from `@sharpforge/bytecode` |
| Source/reloaded numeric frontend | Separate T01.8 integration |
| Browser, native CLR, Rust/Wasm and performance evidence | Not qualified by this increment |

For example, `smallInteger(300, 'byte')` returns `44`, and
`smallIntegerIndirect(255, 'i1')` returns `-1`. The CIL fixtures deliberately
store raw out-of-range values without source casts so destination normalization
is exercised independently of the compiler.

The root validation queue will run this command alone after integration:

```sh
node --max-old-space-size=512 --test --test-concurrency=1 tests/a05-t01-small-storage.test.js tests/a05-seams-numeric.test.js
```

No execution, native comparison or performance measurement was performed in
this implementation slice. Full T01 qualification retains its original native
oracle, engine/platform matrix, cold/warm latency and allocation requirements.
