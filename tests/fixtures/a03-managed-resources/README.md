# Native managed-resource reference

The oracle uses System.Reflection.Metadata to inspect every target's rows, then loads compatible targets in collectible
.NET assembly contexts and reads every public/private/empty resource using GetManifestResourceStream. Other targets
are explicitly `unsupported-host`; header inspection is not reported as native execution. No native binary is committed.

Regenerate sequentially from the repository root (the local validation coordinator must grant the slot first):

```sh
node tests/fixtures/a03-managed-resources/oracle/prepare.js /tmp/a03-resource-fixtures
dotnet build tests/fixtures/a03-managed-resources/oracle/ResourcesOracle.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-resource-obj/ -p:OutputPath=/tmp/a03-resource-bin/
dotnet /tmp/a03-resource-bin/ResourcesOracle.dll /tmp/a03-resource-fixtures/*.dll > tests/fixtures/a03-managed-resources/native.json
node --test --test-concurrency=1 tests/a03-03-managed-resources.test.js tests/a03-03-resource-native.test.js
```

Captured on macOS ARM64 with .NET SDK 10.0.201/runtime 10.0.5. AnyCPU and ARM64 fixtures loaded and returned the expected
256-byte binary, private UTF-8/NUL payload and empty resource. x86/x64 rows were independently read by SRM; execution
is explicitly unsupported on this ARM64 .NET host. All ten focused tests passed, including source and direct CIL
JavaScript engines with all four platform headers. Resource reading is data-only and adds no native/Wasm reflection API.
