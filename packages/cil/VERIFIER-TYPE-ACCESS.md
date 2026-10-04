# Local verifier type access

`createMetadataVerificationContext(inspector, options)` exposes
`isTypeAccessible(targetType, accessingType)`. Both arguments are canonical,
non-generic local TypeDef identities returned by this context's `resolveType`.
The result is the existing frozen `{ status: 'known', value: boolean }` or
`{ status: 'unknown', reason, token }` record. Unknown never grants access.

Top-level public and internal types are accessible inside this same assembly.
Nested types reuse the [member-access lexical rules](VERIFIER-MEMBER-ACCESS.md):
each enclosing boundary is checked as static-member access to its enclosing
type, and a nested caller can exercise its enclosing callers' privileges.
Private, public, assembly, family and both combined family/assembly flags are
covered. Family access to a nested type does not require an instance receiver.
A containing type can name its private nested type without gaining access to
that nested type's private members.

The query follows ECMA-335 sixth edition I.8.5.3.4 and II.10.6 and reuses the
same bounded lexical forest and hierarchy relations as member access. It adds
no metadata copies, type registry, resolver or query cache. Flat type queries
are O(1). Nested queries examine at most 4,096 caller/target pairs, with the
existing 64-edge lexical bound and bounded hierarchy traversal for family
relations. No inspector or source PE storage is retained by the context.

Foreign identities, cloned records and raw tokens throw `CILVT0004`.
Cancellation throws `CILVM0003`; lexical work overflow uses `CILVM0002`, and
hierarchy limits retain `CILVT0002`. Owned visibility and parent facts remain
stable when the source metadata is mutated or released.

Generic enclosing types, interface-family relations and unresolved external
ancestry remain explicit unknowns. TypeRef/TypeSpec resolution, constructed
generic types, cross-assembly/friend access, security demands, signature-type
accessibility and instruction/whole-method verification remain outside this
partial #2400 increment. An accessible type does not prove that a member or
instruction using it is valid.

Eight authored focused tests and fourteen ILAsm/ILVerify cases are described in
the [reference plan](../../tests/fixtures/a03-type-access/README.md).
Validation and performance measurements are pending the serial slot; no native
agreement or passing check is claimed yet.
