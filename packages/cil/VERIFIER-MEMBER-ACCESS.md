# Local verifier member access

`createMetadataVerificationContext(inspector, options)` also exposes
`isMemberAccessible(canonicalMember, accessingType, { receiverType } = {})`.
The member must be a known record from this context's `resolveMember`; types
must be known identities from this context's `resolveType`. Results use the
existing frozen `{ status: 'known', value: boolean }` or
`{ status: 'unknown', reason, token }` shape.

This query covers local, non-generic TypeDefs in one assembly, including nested types. Public, Assembly
and FamORAssem members are accessible throughout that assembly. Private access
requires the declaring type. CompilerControlled access accepts canonical
Def identities within this snapshot; the resolver already refuses MemberRefs
for those definitions. Family and FamANDAssem require the accessing type to be
assignable to the owner. For instance members outside the owner itself, the
receiver must also be assignable to the accessing type. A missing receiver is
`protected-receiver-required`. Static family access needs no receiver.

These rules follow [ECMA-335 sixth edition I.8.5.3.1–2](https://dev.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
Access is separate from declaration resolution, instruction receiver/stack
compatibility and security demands. An accessible member does not establish
that a particular instruction or receiver value is valid.

The owned NestedClass forest supplies lexical ownership. A nested caller can use
its enclosing callers' privileges, transitively; an enclosing or sibling caller
does not acquire another nested type's private members. Every nesting boundary
of the declaring type must also be accessible, so a public member inside a
private nested container does not bypass that container. Protected receivers
are tested against the caller or enclosing caller that grants family privilege.
Nested receiver identities reuse the existing hierarchy relation; this query
still does not establish receiver or signature-type visibility for an instruction. Family queries involving interfaces produce
`interface-family-access`. Missing ancestry retains the existing type-query
unknown result. For example, an unresolved external System.Object root can
prevent proving a negative family relation. Cross-assembly, generic and
whole-method verification remain outside this partial #2400 increment.

One owned Uint8Array stores three visibility bits per TypeDef after existing
`maxTypes` preflight. Construction adds O(types) scalar copies to the existing
row walk; no inspector, source row or PE view is retained. Queries reuse the
canonical member result cache and existing type identity checks, without a
second identity collection. Ordinary visibility checks are O(1); family checks
use the existing bounded hierarchy traversal (`maxQueryNodes`, `maxDepth`).
Member/type budgets and cancellation still apply, including cached queries.

Foreign or forged members throw new `CILVM0004`; foreign types retain
`CILVT0004`. Malformed visibility flags throw `CILVM0001`. Unknown is never an
implicit access grant. Visibility and member facts remain stable if the caller
mutates or releases the source metadata.

Focused tests cover all seven flags for fields/methods, owner/assembly/family
privileges, protected receivers, owned snapshots, limits, cancellation and
foreign identities. The previous flat-access slice (#4237) captured eighteen ILAsm/ILVerify cases:
sixteen known agreements and two explicit unknowns. Its 38 focused contracts
and required local checks passed; these are prior evidence, not qualification
of the pending nesting extension.
Paired context/member controls and new-query timings, raw samples and scope limits
are recorded in the [reference evidence](../../tests/fixtures/a03-member-access/README.md).


The nesting extension follows ECMA-335 I.8.5.3.4 and II.10.6, plus the pinned
[CoreCLR access implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/clsload.cpp#L3899).
Nested type visibility is checked as static-member access to its enclosing type.
Known false visibility dominates an unknown member relation; otherwise uncertainty
is retained, and an independently known grant from an enclosing caller can settle
a previously unknown caller relation.

Raw NestedClass RIDs are checked before token construction, with one owner per
child, visibility consistency and cycle checks. The forest is limited to the
already bounded TypeDef count and 64 nesting edges. It owns one Uint32Array when
nesting exists (none otherwise); temporary color/depth arrays and a reused path
bound construction to O(types + nested rows). Queries examine at most 4,096
caller/target access pairs; each family relation retains its existing hierarchy
limits. Bounds throw CILVM0002, malformed forests CILVM0001, and cancellation
uses the existing query check. No extra identity registry is introduced.

Flat queries avoid lexical scratch state. New nested queries can visit the
product of target and caller depths, capped before the next access check.
Generic enclosing types and interface-family/external relations retain explicit
unknowns; security demands and whole-method type verification remain separate.
The [nested evidence](../../tests/fixtures/a03-nested-access/README.md) records
24 native cases (22 known agreements and two explicit unknowns), 47 passing
focused contracts and required static/structure checks. It retains paired
existing controls, chronological samples and the explicit integration acceptance
of the family-query p95 increase. Broader qualification remains staged.
