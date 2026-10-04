# Lexical type-prefix validation

`validateTypePrefixes(code, metadata, options)` checks `constrained.` and
`readonly.` through the existing bounded instruction-group decoder. Supply the
owning method's `readPE(...).metadata` row reader. The returned groups are
caller-owned and use original byte offsets; input bytes remain unchanged.

This slice uses the ECMA-335 sixth-edition profile: constrained must target
`callvirt`; readonly targets `ldelema` or an exactly recognized array Address
MemberRef call/callvirt. The constrained operand or ldelema
operand must identify a non-nil existing TypeDef, TypeRef or TypeSpec row in the
supplied metadata. Each prefix may occur only once in a group. Other prefixes
retain their structural representation and are not semantically checked here.

The newer .NET constrained call/ldftn extension is outside this strict profile.
Readonly calls recognize the special array Address method from a MemberRef whose
parent TypeSpec is an array/SZArray, whose exact name is Address, and whose default
instance signature takes one Int32 per dimension and returns the same element
by reference. Equality uses existing canonical signature encoding; no CLR type
identity resolution, generic-context validation, or signature-token dereferencing
is performed. Unrecognized shapes remain explicitly unsupported (CILPC0006),
including equivalent type aliases that would require resolution.

The frozen `typePrefixDiagnosticCatalog` contains:

| Code | Meaning |
|---|---|
| CILPC0001 | Duplicate constrained/readonly prefix |
| CILPC0002 | Constrained target is not callvirt in this profile |
| CILPC0003 | Readonly target is not an array address operation |
| CILPC0004 | Type-token table, nonzero row or row extent is invalid |
| CILPC0005 | Missing metadata row reader |
| CILPC0006 | Readonly call needs array Address method resolution |
| CILPC0007 | Array Address metadata exceeds validation limits |
| CILPC0008 | Array Address metadata is malformed |

Semantic failures carry `offset`, `prefix`, `target`, `targetOffset` and, for a
bad type token, `token`. Existing structural failures keep their existing errors.
Constrained/ldelema token checks use the metadata reader's O(1) row lookup
without decoding TypeSpec bodies. Only readonly calls decode the selected array
and method signatures; successful lexical checks do not establish type compatibility. The caller supplies metadata for the same module.

Grouping retains its 16 MiB input, one-million instruction/aggregate-switch-target
and 64-prefix limits. `maxInstructions`, `maxPrefixes` and `signal` pass through.
The added pass is linear in instructions plus prefixes, with scalar duplicate
state and no new successful-path instruction records or whole-table scans.

This is partial #2411. Managed-pointer this compatibility, readonly pointer
propagation/store/escape safety, call arguments and resolved method/type identities
remain open. A readonly ldelema followed by stind passes this lexical slice; success does
not establish verifiability. No execution engine automatically enables this API.

The six focused tests and affected prefix/opcode/CIL compatibility tests pass
(215/215). Pinned ILVerify 10.0.5 agrees on all seven lexical/type-token cases.
Two deliberate differences remain: ILVerify rejects ReadonlyStore, which this
lexical pass accepts, and accepts ArrayAddress, which this pass reports as
unsupported. Raw native observations are retained in the fixture directory.
No method bodies were executed. Broader source VM, browser, Rust and platform
qualification remains staged.

The new-API benchmark retains chronological timing/heap samples. On Apple M3 Pro,
macOS arm64, Node 24.21.0, grouping versus validation median/p95 was
0.663833/0.785000 versus 0.760583/0.851084 ms for 1,000 groups, and
2.292834/2.764000 versus 2.371625/2.581792 ms for 5,000 groups. This is the added
cost of the opt-in pass, not an existing-path before/after comparison. Existing
grouping code is unchanged. It was the sole scheduled team validation job on a
shared host; no significance, speedup or allocation claim is made.

Reference: [ECMA-335 sixth edition, II.14.2, III.2.1 and III.2.3](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).

Array Address recognition creates its cache only on a readonly call. Each selected
MemberRef and parent TypeSpec is decoded once per invocation; later invocations
observe metadata changes. At most 1,024 members/types, 4 KiB per source signature
and 1 MiB aggregate source signature bytes are allowed. Decoding and canonical
encoding use depth 32 / nodes 256; name comparison reads eight fixed heap bytes.
No metadata views, decoded ASTs or cache objects escape the invocation. Budget
checks precede AST expansion. See the [follow-up reference plan](../../tests/fixtures/a03-prefix-array-address/README.md);
it records 222/222 focused/compatibility tests, six in-scope native agreements,
the retained readonly-store divergence, and raw control/new-path timings.
The earlier native result above remains historical; the follow-up implements its
previously unsupported ArrayAddress case while retaining the readonly-store gap.
