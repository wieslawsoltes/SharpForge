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
