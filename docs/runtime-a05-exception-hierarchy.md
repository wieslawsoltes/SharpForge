# Shared managed exception hierarchy — T04.3

The bytecode package exports frozen `managedExceptionTypes` metadata plus
`exceptionTypeName`, `exceptionBaseType`, `exceptionHResult` and `exceptionMatches`.
The runtime retains its `execution/exception-types.js` adapter. Source catch
selection and direct CIL type matching now use the same framework base chains.
Source matching also follows registered user MethodTables when a framework-only
lookup cannot answer the catch relationship.

Short framework names normalize to their canonical namespaces. Qualified user
names retain their identity: `Acme.OverflowException` does not become
`System.OverflowException`. Internal invalid-reference faults have managed type
`InvalidProgramException`; runtime/assertion faults use `Exception`; resource-limit
faults use `ExecutionEngineException`. Their diagnostic fault names remain intact.
This metadata mapping does not change the runtime's fatal-fault policy.

The table follows .NET 10
[CoreLib HRESULT constants](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/Common/src/System/HResults.cs)
and [exception declarations](https://github.com/dotnet/runtime/tree/v10.0.0/src/libraries/System.Private.CoreLib/src/System).
`AmbiguousImplementationException` derives directly from `Exception`;
`ExecutionEngineException` derives from `SystemException`.

`exceptionMatches` compares framework ancestry and treats any managed fault as an
`Exception`/`Object`. It does not infer user-defined ancestry from names. Unknown
names have no declared base and use the generic exception HRESULT. The frozen
metadata is process-wide immutable data; MethodTable identities remain VM-owned.

This small slice preserves main's existing exception dispatch and unwind order.
It does not add two-pass search, filters, exception object fields, source typed-catch
syntax, or portable snapshots. Those remain separate E01 batches. The source
adapter accepts typed handler metadata; existing compiler diagnostics for broader
typed-catch syntax are unchanged.

`tests/a05-exception-hierarchy.test.js` covers framework ancestry, siblings, internal
aliases, custom namespaces, user MethodTable inheritance, source handler selection,
and independent direct CIL fixtures. Existing runtime-fault fixtures include native
Roslyn-produced arithmetic/SystemException catches. This slice has not run tests;
validation belongs to the serialized integration queue. No new browser, native,
Rust/Wasm, or performance result is claimed. Hierarchy lookup uses precomputed maps
and ancestor sets; it allocates no per-match collection.
