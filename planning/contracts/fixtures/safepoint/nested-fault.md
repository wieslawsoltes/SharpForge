# Nested-fault fixture contract

This fixture tests replacement of an exception **during an actual unwind** and
portable transfer of the replacement fault. Its terminal expectation remains
`second`. An enclosing `catch (Exception) { throw; }` supplies a first-pass
handler for `first`; the inner finally then throws `second`, and the selected
catch rethrows that replacement.

The previous input had only `try { throw first; } finally { throw second; }` at
the entry point. No handler was available. Expecting `second` from that input
conflated handler-selected unwind with unhandled process termination and
contradicted A05 #1371's retained throwing-frame contract. The original input
is preserved byte-for-byte in `tests/a00-04-nested-fault.test.js` and independently
checks `first`, retained frame IDs/PCs, managed exception rooting during GC,
snapshot restore and no accidental execution after the terminal fault. The
replacement fixture also retains its schema-v1/v2 checks in all three routes.

[C# specification §22.4](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/exceptions#224-how-exceptions-are-handled)
defines handler search before the intervening finally clauses and separately
describes thread-entry termination when no matching handler exists. It leaves
the impact of that termination implementation-defined. This reference explains
the fixture construction; it is not a captured native execution of this file.

The existing native fixture
`tests/fixtures/a05-control-exceptions/Program.cs` likewise supplies an original
exception catch so its throwing finally is reached. Its passing native result
supports that related replacement scenario. Neither that different source nor
the old `planning/contracts/abi-benchmark.json` JavaScript-only observation is
an exact native oracle for this internal A00 fixture. No such capture is claimed
by this correction. Native qualification remains scoped to the actually
executed fixture hashes and runtime versions in the A05 evidence.

No runtime policy, fault schema, expected replacement message, safepoint kind,
or historical benchmark result changes as part of this correction.
