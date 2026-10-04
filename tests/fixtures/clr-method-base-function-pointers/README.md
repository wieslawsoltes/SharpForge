# Function-pointer override oracle

`Program.cs` prepares twelve native matching signatures and six independent
Root(A) → Middle(B,new-slot) → Child(A,reuse-slot) mismatch chains. They cover
managed/unmanaged convention, arity, return and parameter identity, nested
signatures, byrefs, pointers, custom calling-convention modifiers, method return
types and enclosing method generic parameters. No function pointer is invoked.
Type-load failures are retained as records instead of being silently skipped.

SDK 10.0.201/CoreCLR 10.0.5 captured all eighteen observations with no type-load
errors; all native roots agree with the loader. The mandatory reference test
checks matching source/image hashes and has no availability skip. All 41 focused
tests passed under the serial limiter. Existing capture and benchmark seams apply:

```
node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-function-pointers tests/fixtures/clr-method-base-function-pointers/Program.cs --unsafe
node packages/clr/tools/benchmark-method-base-definition.mjs tests/fixtures/clr-method-base-function-pointers/native-method-bases.json --function-pointers
```

The native test and benchmark share an explicit test-host registration of two
CoreLib calling-convention marker identities. Generic function-pointer headers,
instance/vararg function pointers and function-pointer-bearing generic argument
subtrees remain unsupported. This is signature comparison, not invocation or ABI
qualification.
