# Modified override oracle

`Program.cs` independently emits ten matching required/optional modifier signatures
with the installed .NET 10 `PersistedAssemblyBuilder`. It records CoreCLR
`GetBaseDefinition` identities for return, parameter, ordered, mixed, byref and
array forms without executing an emitted method body.

Captured with SDK 10.0.201/CoreCLR 10.0.5 in the exclusive validation slot. All
ten observations agree with the loader. The mandatory reference test verifies
source/image provenance without an availability skip. The capture tool retains
the generated image separately from the compiled harness hash:

```
node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-modifiers tests/fixtures/clr-method-base-modifiers/Program.cs
```

The existing base-definition benchmark accepts this emitted fixture with an
explicit test-host CoreLib resolver (ordinary benchmark defaults are preserved):

```
node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-modifiers/native-method-bases.json --corelib-intrinsics
```

Kind/order/identity mismatches, malformed tokens, unsupported generic modifier
definitions and modifier-bearing generic argument subtrees,
limits and cancellation are additionally covered by authored metadata tests.
Opaque intrinsic-slot traversal, TypeSpec modifier resolution and generic base
substitution remain unsupported by this increment.
