# Function-pointer override oracle

`Program.cs` prepares twelve native matching signatures and six independent
Root(A) → Middle(B,new-slot) → Child(A,reuse-slot) mismatch chains. They cover
managed/unmanaged convention, arity, return and parameter identity, nested
signatures, byrefs, pointers, custom calling-convention modifiers, method return
types and enclosing method generic parameters. No function pointer is invoked.
Type-load failures are retained as records instead of being silently skipped.

Capture and tests are pending the exclusive validation slot. The mandatory
reference test requires all eighteen observations and matching source/image
hashes; it has no availability skip. Existing capture and benchmark seams apply:

```
node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-function-pointers tests/fixtures/clr-method-base-function-pointers/Program.cs --unsafe
node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-function-pointers/native-method-bases.json --function-pointers
```

The native test and benchmark share an explicit test-host registration of two
CoreLib calling-convention marker identities. Generic function-pointer headers,
instance/vararg function pointers and function-pointer-bearing generic argument
subtrees remain unsupported. This is signature comparison, not invocation or ABI
qualification.
