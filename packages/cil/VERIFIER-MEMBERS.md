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
a field name/signature declared directly, or the nearest exact method declaration
along a local class base chain. Constructors and type initializers must also be declared directly.
Interface inheritance and unresolved/generic ancestry remain explicit unknowns. Overloads are indexed by
owner, name and signature, not searched linearly. Public and private definitions
can both be resolved: accessibility is a separate query, not implied by symbol
resolution. Compiler-controlled definitions resolve through definition tokens;
MemberRefs to them remain unknown, following ECMA-335 I.8.5.3.2.

Unresolved owners/signature types, unmatched/ambiguous declarations, MethodSpec,
generic signatures, function pointers, varargs and non-default method conventions
produce explicit unknown results. Same-named externals never bind locally. This
increment does not perform TypeRef alias unification,
custom-modifier equivalence or whole-method verification. The separate
[local member-access query](VERIFIER-MEMBER-ACCESS.md) handles local same-assembly
rules, including bounded nested accessibility. The [local type-access query](VERIFIER-TYPE-ACCESS.md)
reuses those nested visibility and enclosing-caller privileges without a member
or receiver. External/generic access and whole-method #2400/#2407 services remain
open; a missing or unsupported result must never grant access.

Construction is O(type rows + member rows + copied heap bytes). Definition and
exact declaration lookup are indexed; inherited lookup walks one base chain in
O(depth) time and O(1) additional query storage, reusing canonical `baseType`.
There is no new identity collection or cache. Shared `maxDepth` (256) and
`maxQueryNodes` (4096) limits bound that walk; direct hits need no ancestry work.
A signature is decoded once per unique
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

## Inherited-reference increment (qualification pending)

The isolated `codex/a03-inherited-member-references` increment adds nearest exact
class method declaration lookup; an ambiguous or compiler-controlled nearest match
never falls back to a base member. Resolution does not grant accessibility or
perform receiver typing/dispatch. Unknown direct misses now retain the actual
unresolved base result when traversal reaches one. Class metadata validity and
value-type normalization remain separate from this bounded lookup service.

Seven authored tests cover direct-only fields and inherited method overloads, nearest hiding, private
access separation, direct-only constructors, ambiguous/compiler-controlled
barriers, unknown ancestry, budgets, cancellation and owned source snapshots.
A ten-case native plan uses pinned SDK 10.0.201/CoreCLR 10.0.5 `Module.ResolveMember`:
five expected declaration agreements plus five explicit adapter unknowns where
native resolution is expected to throw. The existing reference harness seams
retain tool/source/image hashes and raw output before assertions. No methods
from the generated fixture are executed. Primary implementation evidence is
[CoreCLR member lookup](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/memberload.cpp#L993),
which searches class bases and excludes inherited instance initializers.

Local install/native/tests/paired existing-context controls/static checks have
not run. They await the serial limiter slot, with concurrency 1 and a 1 GiB heap.
The exact existing `benchmark-verifier-members.mjs` controls will run once on
the parent and candidate; all chronological samples and any failures will be
retained. The wider engine/platform matrix remains staged.

### Native correction before qualification

The initial broader hypothesis allowed inherited field references. Pinned native
`Module.ResolveMember` rejected the first such reference; its complete stopped
output and original fixture bytes are retained in `inherited-native-initial-failure.json`.
An independent two-class/one-field diagnostic confirms the declaring-owner
reference resolves while the derived-owner reference fails, with native reflected
base/field ownership in `inherited-field-diagnostic.json`. The pinned
[CoreCLR FindField](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/memberload.cpp#L1378)
searches only the supplied class, unlike FindMethod's recursive base search.
[RuntimeModule](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/System.Private.CoreLib/src/System/Reflection/RuntimeModule.cs#L185)
catches MissingFieldException and the literal-field fallback rejects these
MemberRef tokens as ArgumentOutOfRangeException. This is a semantic correction,
not unavailable oracle evidence. Product lookup now keeps fields direct-only;
tests require all three derived-owner field references to remain unknown.
No accessibility, receiver typing or dispatch support is implied.
