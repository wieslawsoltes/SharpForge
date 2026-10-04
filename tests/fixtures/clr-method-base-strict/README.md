# Strict override access oracle

The independent PersistedAssemblyBuilder fixture emits twelve same-assembly,
top-level, nongeneric override pairs. Eight cover matching/widened accessibility;
four cover private-base access, public narrowing, family-to-assembly changes,
and family-or-assembly-to-family narrowing. Reflection records GetBaseDefinition
or the actual type-load failure, with metadata tokens obtained independently from
SRM. No method is invoked. Source/image hashes are mandatory in the native test.

Capture, authored tests and benchmarks are pending the assigned serial slot.
No availability skip or reference pass is claimed before that capture.

```sh
node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-strict tests/fixtures/clr-method-base-strict/Program.cs
node --test --test-concurrency=1 tests/clr-methods-base-strict*.test.js tests/clr-methods-base-definition.test.js
node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-strict/native-method-bases.json --corelib-intrinsics --accepted-records
```

The benchmark option selects only the eight successful records outside timed
sections; the four failures stay in the original capture and mandatory test.
Existing default benchmark work remains unchanged. Broader execution, cross-assembly
friend access, nesting, generic owners/methods and explicit class MethodImpl remain
outside this increment.
