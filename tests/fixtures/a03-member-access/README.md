# Member-access reference plan

Implementation-ready, unvalidated draft. No native result is claimed yet.
`capture.mjs` uses the existing pinned ILAsm/ILVerify 10.0.5 tools and .NET SDK
10.0.201 reference pack. Eighteen isolated assemblies cover public, private,
assembly, family-or-assembly, family and family-and-assembly for fields/methods,
including protected receivers and static family access. Only the named Test
method is verified; no fixture is executed. Source/assembly/tool hashes and raw
assembler/verifier output are retained before assertions.

Sixteen queries are expected to agree as known booleans. Two rejected native
base-receiver cases deliberately remain unknown in this adapter: their external
System.Object root is unresolved. Those are recorded separately, not counted as
proved rejections. CompilerControlled Def identity and nested/interface unknowns
are covered by focused metadata tests; this capture does not claim native support
for those cases or full instruction verification.

```sh
node scripts/limited.js node tests/fixtures/a03-member-access/capture.mjs tests/fixtures/a03-member-access/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-member-access.test.js
```

Set tool environment as documented in `tests/conformance/verifier/README.md`.
The snapshot fixture uses a closed local hierarchy to prove both positive and
negative ancestry independently of external-name resolution. Native assembly
queries use their actual metadata, preserving unresolved-root uncertainty.
The same benchmark harness measures exact-parent/candidate context construction
and existing member resolution, and candidate-only public/family access queries,
with raw chronological samples. No timing/space claim is made before capture.
