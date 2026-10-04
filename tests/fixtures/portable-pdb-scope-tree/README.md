# Lexical scopes and typed local slots

The `packages/symbols/interop/ScopeTree` Debug C# fixture contains nested and
sibling scopes and primitive/array/constructed local types.
The executable reads its own Portable PDB with System.Reflection.Metadata,
uses `LocalScope.GetChildren()` to establish nesting, and decodes the PE's local
StandAloneSig through `DecodeLocalSignature`. The fixture provider supports its
observed type forms; other forms fail rather than fabricate reference names.

Scheduled capture (pending; no native run or local validation yet):

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
DOTNET_PATH=/Users/wieslawsoltes/.dotnet/dotnet \
node scripts/limited.js node scripts/validate-pdb-scope-tree.mjs \
  --capture tests/fixtures/portable-pdb-scope-tree
```

Only explicit capture writes reference JSON/binaries. Offline focused tests
read captured data and separately exercise hidden flags, exact AST ownership,
missing signatures, invalid slots, nesting/order and aggregate bounds. No IDE,
Windows PDB, runtime-value or external-assembly qualification is claimed.
