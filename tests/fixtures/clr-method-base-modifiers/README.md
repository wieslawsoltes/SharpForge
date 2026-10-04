# Modified override oracle

`Program.cs` independently emits ten matching required/optional modifier signatures
with the installed .NET 10 `PersistedAssemblyBuilder`. It records CoreCLR
`GetBaseDefinition` identities for return, parameter, ordered, mixed, byref and
array forms without executing an emitted method body.

Capture is pending the exclusive validation slot. The mandatory reference test
requires the resulting image/source hashes and all ten observations; there is no
availability skip. The capture tool retains the generated image separately from
the compiled harness hash:

```
node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-modifiers tests/fixtures/clr-method-base-modifiers/Program.cs
```

The existing base-definition benchmark accepts this emitted fixture with an
explicit test-host CoreLib resolver (ordinary benchmark defaults are preserved):

```
node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-modifiers/native-method-bases.json --corelib-intrinsics
```

Kind/order/identity mismatches, malformed tokens, unsupported generic modifiers,
limits and cancellation are additionally covered by authored metadata tests.
Opaque intrinsic-slot traversal, TypeSpec modifier resolution and generic base
substitution remain unsupported by this increment.
