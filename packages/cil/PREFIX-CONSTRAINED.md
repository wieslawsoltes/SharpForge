# Lexical type-prefix validation

`validateTypePrefixes(code, metadata, options)` checks `constrained.` and
`readonly.` through the existing bounded instruction-group decoder. Supply the
owning method's `readPE(...).metadata` row reader. The returned groups are
caller-owned and use original byte offsets; input bytes remain unchanged.

This slice uses the ECMA-335 sixth-edition profile: constrained must target
`callvirt`; readonly must target `ldelema`. The constrained operand or ldelema
operand must identify a non-nil existing TypeDef, TypeRef or TypeSpec row in the
supplied metadata. Each prefix may occur only once in a group. Other prefixes
retain their structural representation and are not semantically checked here.

The newer .NET constrained call/ldftn extension is outside this strict profile.
Readonly calls may name the special array Address method, but identifying that
member needs method resolution; this slice returns an explicit unsupported-case
diagnostic rather than constructing a second resolver or depending on CLR.

The frozen `typePrefixDiagnosticCatalog` contains:

| Code | Meaning |
|---|---|
| CILPC0001 | Duplicate constrained/readonly prefix |
| CILPC0002 | Constrained target is not callvirt in this profile |
| CILPC0003 | Readonly target is not an array address operation |
| CILPC0004 | Type-token table, nonzero row or row extent is invalid |
| CILPC0005 | Missing metadata row reader |
| CILPC0006 | Readonly call needs array Address method resolution |

Semantic failures carry `offset`, `prefix`, `target`, `targetOffset` and, for a
bad type token, `token`. Existing structural failures keep their existing errors.
Token checks call the metadata reader's O(1) row lookup; they do not decode or
resolve TypeSpec bodies, read signatures, validate the target method token or
establish type compatibility. The caller supplies metadata for the same module.

Grouping retains its 16 MiB input, one-million instruction/aggregate-switch-target
and 64-prefix limits. `maxInstructions`, `maxPrefixes` and `signal` pass through.
The added pass is linear in instructions plus prefixes, with scalar duplicate
state and no new successful-path instruction records or whole-table scans.

This is partial #2411. Managed-pointer this compatibility, readonly pointer
propagation/store/escape safety, call arguments and array Address resolution remain
open. A readonly ldelema followed by stind passes this lexical slice; success does
not establish verifiability. No execution engine automatically enables this API.

Six focused cases and a nine-method pinned ILVerify capture are prepared. The
capture includes readonly stores and array Address calls specifically to retain
the partial-scope differences. No native result or local test/check/performance
result is claimed before the scheduled validation slot. Broader source VM,
browser, Rust and platform qualification remains staged.

Reference: [ECMA-335 sixth edition, III.2.1 and III.2.3](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
