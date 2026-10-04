# Modified override oracle

`Program.cs` independently emits ten matching required/optional modifier signatures
with the installed .NET 10 `PersistedAssemblyBuilder`. It also emits five independent three-level mismatch chains. It records CoreCLR
`GetBaseDefinition` identities for return, parameter, ordered, mixed, byref and
array forms without executing an emitted method body.

Captured with SDK 10.0.201/CoreCLR 10.0.5 in the exclusive validation slot. All
fifteen observations agree with the loader. The mandatory reference test verifies
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

For kind, identity, optional-modifier order, omission and return/parameter placement,
each Root(A) → Middle(B,new-slot) → Child(A,reuse-slot) chain resolves Child to Root.
This proves that the mismatch is slot-significant without traversing the adapter's
unsupported intrinsic Object slots. Type-load failures would be retained as oracle
records; none occurred. Authored tests additionally cover malformed tokens,
unsupported generic modifier definitions/subtrees, limits and cancellation.

`native-method-bases-initial.json` preserves the original matching-only capture
used by all retained ten-method benchmark samples. Its exact source is commit
`7f4958b098ea7b3577f986e2c2c2d95dfa305d1d`. Only the native capture and two affected
test files ran after this coverage extension; product code and controls did not
change.
Opaque intrinsic-slot traversal, TypeSpec modifier resolution and generic base
substitution remain unsupported by this increment.
