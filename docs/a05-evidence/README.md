# A05 qualification evidence

The raw Project 7 / A05 reports are retained in the source repository under
`planning/qualification/a05-evidence/`. They are qualification inputs and records,
not Studio runtime assets. This small index remains in the shipped documentation.

The relocation preserves every original file byte, including failed observations,
embedded historical paths, commands, environment records and original manifests.
Historical acceptance ledgers retain their recorded paths and conclusions. The
additive relocation manifests map those paths to their current repository location
with the original Git blob, SHA-256 and byte length. The hash-bound chain includes
text-suffix renames for archived command drivers; their bytes remain unchanged.

The path map records the immutable pre-relocation source revision and tree.
The [qualification archive][archive] and [relocation chain][map] are also available
on the source host. New raw observations belong in the
qualification directory, including follow-up native and hosted validation runs.

Moving these records changes packaging, not any measured result or acceptance
threshold. Complete output size still needs measurement under the unchanged build
and size policies; earlier size observations remain retained.


[archive]: https://github.com/wieslawsoltes/SharpForge/tree/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/
[map]: https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence-relocations/chain.json
