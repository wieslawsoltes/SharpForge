# Exact JSON Int64 access

`JsonElement.GetInt64()` reads the original integer token, so values such as
`9007199254740993` remain exact through source VM bytecode and direct CIL. The result
uses the existing managed `long` / BigInt representation. A09 contract ID
`655360` is additive; released IDs do not move.

Decimal-point and exponent tokens are rejected even if their mathematical value
is integral, matching .NET. Out-of-range integers raise `FormatException`;
non-number elements raise `InvalidOperationException`. Disposed documents retain
the existing `ObjectDisposedException` behavior. Tokens longer than 20 characters
are rejected before creating a BigInt. JSON parser text/depth/node limits remain
in force, and `GetRawText` retains the original source spelling.

`GetDouble` remains approximate, and exact Decimal access and `TryGetInt64` are
separate capabilities. Browser and Rust native/Wasm execution are not qualified
by this change.

The source compiler still rejects Int64 execution with `SF2200` and typed catch
clauses with `SF2002`. This accessor does not expand either compiler capability.
Tests execute real source bytecode and independently assembled CIL, asserting
the exact managed BigInt result or fault type for every captured case, including
property/array access and disposed documents. Both compiler pipelines separately
assert the unchanged profile diagnostics.

The .NET reference under `tests/fixtures/json-int64` pins SDK 10.0.201 and runtime
10.0.5. Its source and all 63 captured output lines remain unchanged. Ordinary
tests consume its captured JSON; they do not start a native build.
