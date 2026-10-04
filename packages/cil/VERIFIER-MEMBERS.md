# Metadata verifier member context

`createMetadataVerificationContext(inspector, options)` composes the existing
metadata type-system adapter with `resolveMember(token)`. The lighter
`createMetadataVerificationTypeSystem` remains unchanged. Context construction
snapshots bounded Field, MethodDef and MemberRef facts, unique signature blobs
and member names; it does not retain an inspector or borrowed PE views.

`resolveMember` returns the same frozen known/unknown result shape as type
queries. Known values are frozen canonical records with `token` (definition
identity), `kind`, `owner` (context-issued type identity), `name`, `flags`,
`isStatic`, and a recursively frozen signature AST. A definition and every
resolved reference to it share the same record. AST tokens remain scoped to this
context and are not normalized verification-stack types.

Supported references have a local, non-generic TypeDef parent and exactly match
a declared field/method name and encoded signature. Overloads are indexed by
owner, name and signature, not searched linearly. Public and private definitions
can both be resolved: accessibility is a separate query, not implied by symbol
resolution. Compiler-controlled definitions resolve through definition tokens;
MemberRefs to them remain unknown, following ECMA-335 I.8.5.3.2.

Unresolved owners/signature types, unmatched/ambiguous declarations, MethodSpec,
generic signatures, function pointers, varargs and non-default method conventions
produce explicit unknown results. Same-named externals never bind locally. This
increment does not perform inherited-member search, TypeRef alias unification,
custom-modifier equivalence or whole-method verification. The separate
[local member-access query](VERIFIER-MEMBER-ACCESS.md) handles flat same-assembly
access rules with explicit unknowns for unsupported ancestry/nesting. Those
remaining #2400/#2407 services stay open; a missing or unsupported result must
never be treated as an accepted call or field access.

Construction is O(type rows + member rows + copied heap bytes). Definition and
exact declaration lookup are indexed; a signature is decoded once per unique
heap entry on demand. Default/hard limits are 65,535 total Field/MethodDef/MemberRef
rows (`maxMembers`), 1 MiB each for copied signature/name bytes (`maxMemberBytes`),
and 65,536 decoded signature AST nodes (`maxMemberSignatureNodes`). Options may
lower limits. Individual names are limited to 1,024 UTF-8 bytes and blobs to
4 KiB; signature decoding allows depth 32 / 256 nodes before aggregate accounting.
Pointer-table counts are bounded before `metadata.list` expansion; ownership is
checked for duplicate/orphan definitions. The supplied `signal` applies to
construction and later queries. Type-system budgets still apply independently.

Malformed metadata throws `CILVM0001` (including invalid/over-complex signature
encoding), aggregate limits throw `CILVM0002`, and cancellation throws `CILVM0003`. Foreign access-query member identities
throw `CILVM0004`.
Type-token/hierarchy errors retain their existing `CILVT` diagnostics. This is an
opt-in JavaScript metadata service; execution engines and broad platform
qualification are not activated or claimed by it.
