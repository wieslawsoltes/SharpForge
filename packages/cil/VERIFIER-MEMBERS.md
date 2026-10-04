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

## Retained validation

Product commit `f42169ae685c5df7fd13cc1c0e34981ff54d17aa` includes the shared
coded-index bounds fix (#4198). The new member scope and affected type/signature
contracts pass 34/34 focused tests, with no skips. The captured .NET 10.0.5
`Module.ResolveMember` oracle agrees on twelve definition/reference resolutions,
including overloads, an instance method, a private method and a local type in a
signature. SDK 10.0.201 / Roslyn 5.3.0 compiled the reference harness; exact tool
versions, source/fixture hashes and raw output are in
`tests/fixtures/a03-verifier-members/native.json`.

The sequential validation reservation ran installation, native capture, focused
tests, benchmark, static checks and structure checks, with test concurrency 1 and
a 1 GiB Node heap cap. Static checks inspected 3,263 syntax and 3,259 import modules
with zero errors; test manifests covered 842 Node and 36 browser files without
unassigned/duplicate entries. Structure reported 269 existing findings, none in
this change. Full engine/platform qualification remains staged.

Benchmark command: `node --expose-gc packages/cil/tools/benchmark-verifier-members.mjs OUTPUT.json`,
under the same `scripts/limited.js` reservation. Shared Apple M3 Pro/macOS 26.6,
Node 24.21.0; no quiet-machine claim. Each mode records twelve chronological
samples of 1,000 operations, excluding the first three warmups from statistics.
Construction median/p95: 9.134958/10.902416 ms per 1,000 contexts. Cached-reference
query median/p95: 0.023542/0.060667 ms per 1,000 queries. All samples and heap
changes are retained in `tests/fixtures/a03-verifier-members/performance.json`.
Heap deltas are not allocation counts or peak memory. This is a new opt-in API;
there is no previous implementation or speedup comparison. The existing lighter
hierarchy factory and query paths are unchanged.
