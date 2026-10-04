This offline corpus is explicitly captured by
`DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-closure-map.mjs --capture tests/fixtures/portable-pdb-closure-map`.
Normal tests never build or modify these files.

The native SRM oracle reads the original Portable PDB EnC lambda records and PE
type/field/method identities. Two C# classes have a method named `Nested`, each
with two nested lambdas sharing one captured variable. The mapping must preserve
the enclosing type, original method, lambda/closure ordinals and syntax offsets.
The source, compiler, assembly and PDB SHA-256 hashes are recorded alongside the
native values. This is one Roslyn C# Debug fixture, not generic, EnC-generation,
capture-link traversal, VB or cross-platform qualification.
