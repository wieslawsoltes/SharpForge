# Constrained generic method roots

`Program.cs` records native `MethodInfo.GetBaseDefinition` for 12 declared C#
methods with class, struct, constructor, local class and interface constraints.
It also uses .NET `PersistedAssemblyBuilder` to independently emit three images:
class/new requirements weakened to class, struct weakened to constructor, and
an invalid added class requirement. CoreCLR reflection supplies accepted roots
or `TypeLoadException`; retained images are inspected by the CLR loader tests.

Capture is pending the shared serial slot. The mandatory test intentionally
requires `native-method-bases.json`; it has no availability skip. Both the compiled
C# image and emitted images retain SHA-256 provenance. No dynamic image executes
its method body.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-constraints tests/fixtures/clr-method-base-constraints/Program.cs
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-base-constraints*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-constraints/native-method-bases.json
```
