# Constrained generic method roots

`Program.cs` records native `MethodInfo.GetBaseDefinition` for 12 declared C#
methods with class, struct, constructor, local class and interface constraints.
It also uses .NET `PersistedAssemblyBuilder` to independently emit three images:
class/new requirements weakened to class, struct weakened to constructor, and
an invalid added class requirement. CoreCLR reflection supplies accepted roots
or `TypeLoadException`; retained images are inspected by the CLR loader tests.

SDK 10.0.201/CoreCLR 10.0.5 captured all 12 method roots and three compatibility
images. The first two emitted cases were accepted; the added class constraint
raised TypeLoadException. All 32 affected tests pass with zero skips. The mandatory
test verifies SHA-256 provenance for the source, compiled C# image and emitted
images. No dynamic image executes its method body. Detailed checks and all raw
benchmark samples are linked from `packages/clr/METHOD-BASE-DEFINITION.md`.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-constraints tests/fixtures/clr-method-base-constraints/Program.cs
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-base-constraints*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-constraints/native-method-bases.json
```
