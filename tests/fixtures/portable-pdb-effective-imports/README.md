This corpus is explicitly captured with `scripts/validate-pdb-effective-imports.mjs --capture tests/fixtures/portable-pdb-effective-imports`.
It records Roslyn nested namespace imports and the corresponding SRM parent-to-child list, including aliases and a static type import.
The capture records SDK/compiler/runtime versions, source hash and DLL/PDB hashes. Offline tests only read these files.
