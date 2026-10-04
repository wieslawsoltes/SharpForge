# Source numeric modes (SF-A05-T01.8)

The source runtime uses the shared CLI arithmetic helpers for `sbyte`, `byte`,
`short`, `ushort`, `char`, `uint`, `long`, `ulong`, `nint`, `nuint`, `float`,
`double`, and `decimal`. The semantic compiler preserves the binder's numeric
conversions and checked context when lowering ordinary C# to source IR. This
includes captured values, arguments, return values, compound assignment and
increment. Existing Int32/Double-only instructions retain their encoding.
Predefined numeric bounds and IEEE constants are represented as typed constants
in the semantic core registry. Decimal lexer coefficient/scale data is converted
directly into the compiler's exact constant representation. Neither change
suppresses a parser error or admits an unregistered framework method.
When semantic lowering replaces the execution profile, existing builtin receiver
shorthands such as `Console` remain available after normal lexical lookup. This
fallback does not import a namespace, override an alias/local, or apply with
explicit metadata references or an explicit `implicitUsings` policy. Ordinary
semantic analysis retains C# name resolution. Synthesized delegate return
temporaries use the same typed scalar defaults as user locals.

`NumericType` preserves Int32 and Double IDs 0 and 1 and appends the other
types. `numericMode(type, checked)` encodes typed operations starting at 16;
legacy modes 0, 1, 2, 3 and 5 keep their previous meaning. Binary `>>>` is appended
after the existing operators. No opcode, builtin, contract ID or image version
is renumbered. `verifyImage` rejects invalid operator/mode combinations and
malformed scalar constants.

`encodeScalar` / `decodeScalar` preserve integer widths, IEEE special values,
negative zero and Decimal coefficient/scale in JSON-compatible image constants.
Runtime values use Int32 Numbers, Int64 BigInts, immutable floating/native
carriers, or the shared immutable Decimal carrier. Native width is an immutable
per-VM `nativeIntBits` option (32 by default, or 64), shared with direct CIL.
Source snapshots use their existing constant cache and value-copy machinery;
this change adds no snapshot fields or managed-handle caches.

CLI emission uses ordinary arithmetic/conversion instructions and System.Decimal
operators. Stack-neutral type-token markers preserve declared source signedness
when the assembly is reloaded. The loader decodes executable IL and verifies it
by canonical re-emission; debug metadata contains no executable source bytecode.
Declared types also reach existing formatting/boxing bridges so unsigned stack
bit patterns and `char` are displayed correctly. Single-precision default text
uses a shortest round-trip decimal representation.

The focused fixtures compile C# once and run source IR, reloaded source IR, and
direct CIL. They cover narrow wrapping, checked faults, UInt64 limits, shifts,
Single rounding, exact Decimal arithmetic/scale, both native widths, boxing,
capture, array storage, JSON image round trips and snapshot replay. Serial
validation with Node24.21.0 passed 226/232 tests at `f5d60ce9`; the six failures
identified a registry-adapter lookup defect. After fixing that lookup and replacing
two stale unsupported expectations with positive execution regressions, all 175
source numeric/compiler cases passed at `2d28cde0`. Alias-policy and global-using
cases also passed in the intervening focused run. Scalar wire/box/ABI tests passed
in the integrated batch. No original failing scalar assertion was removed.

The formerly rejected generic and init-property declarations were already handled
by semantic lowering; retaining the profile's Console shorthand now allows their
existing code generation to run. Fixtures assert their emitted execution, including
actual generic calls and init-property values, across all three engines.

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-source-numeric-modes.test.js tests/compiler.test.js
```

Native, browser, Windows, Linux, Rust, Wasm and performance qualification remains
staged. The original full acceptance of #1351 remains open until its independent
engine/platform evidence is collected.

This slice does not register additional framework overloads. Numeric library
methods, parsing APIs and unregistered constructions such as `Task<long>` retain
their existing explicit unsupported diagnostics. Decimal library APIs use a
separate direct-CIL intrinsic profile. The subsequent
[source Decimal families](source-decimal-rounding.md) admit Round with one or two
arguments, Truncate, Ceiling, Floor, Parse(string) and the five static arithmetic
methods plus static Compare/Equals, Negate/Abs, the eight integral To* conversions
and ToSingle/ToDouble through that same profile; other source Decimal library
APIs remain unsupported. Wider frontend work remains with the compiler workstream.
