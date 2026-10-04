# Closed generic values and type names

This authored trace covers boxing through a substituted generic method parameter,
independent closed box storage, repeated BCL
ToString callbacks with collection, unboxing, logical type names, distinct
runtime types, nested owners and array type arguments. `expected.txt` is the
intended deterministic output, not a captured native qualification result.

Run the exact SDK's Roslyn assembly on both that native runtime and the CIL VM:

```sh
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/source-generic-values --output artifacts/a05-source-generic-values
```

The focused A05 native matrix includes this case independently on SDK 8 and 10.
Its artifact records supply the actual SDK, source and assembly hashes and
outcomes. Source image / reloaded source / source-emitted CIL projection tests
are separate in `tests/a05-source-generic-type-identities.test.js`; this native
fixture uses real CLI generics and does not qualify the native CLR's reflection
over physical monomorphized source TypeDefs.
