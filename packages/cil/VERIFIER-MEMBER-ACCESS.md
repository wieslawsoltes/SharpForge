# Local verifier member access

`createMetadataVerificationContext(inspector, options)` also exposes
`isMemberAccessible(canonicalMember, accessingType, { receiverType } = {})`.
The member must be a known record from this context's `resolveMember`; types
must be known identities from this context's `resolveType`. Results use the
existing frozen `{ status: 'known', value: boolean }` or
`{ status: 'unknown', reason, token }` shape.

This query covers flat, non-generic TypeDefs in one assembly. Public, Assembly
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

Nested declaring, accessing or supplied receiver types produce
`nested-member-access`, including otherwise public accesses; the nested access
graph is deferred. Family queries involving interfaces produce
`interface-family-access`. Missing ancestry retains the existing type-query
unknown result. For example, an unresolved external System.Object root can
prevent proving a negative family relation. Cross-assembly, generic, nested and
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
foreign identities. A bounded eighteen-case ILAsm/ILVerify capture and paired
context-construction/new-query timing harness are prepared; local qualification
is pending the serial slot. See the [reference plan](../../tests/fixtures/a03-member-access/README.md).
