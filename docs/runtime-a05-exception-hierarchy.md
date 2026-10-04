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

At the original T04.3 boundary, this slice preserved the then-current exception
dispatch and unwind order. Two-pass search, filters, exception object fields,
source typed catches and portable snapshots were separate E01 batches. Those
implementations are now integrated; their current qualification status is tracked
in the Project 7 criterion audit rather than implied by the historical hierarchy run.

`tests/a05-exception-hierarchy.test.js` covers framework ancestry, siblings, internal
aliases, custom namespaces, user MethodTable inheritance, source handler selection,
and independent direct CIL fixtures. Existing runtime-fault fixtures include native
Roslyn-produced arithmetic/SystemException catches. The serialized queue passed
62 focused hierarchy/fault/source-seam tests and 15 ABI contract tests on Node
24.21.0. No new browser, native, Rust/Wasm, or performance result is claimed. Hierarchy lookup uses precomputed maps
and ancestor sets; it allocates no per-match collection.

## Current filter and cleanup example

```sh
node scripts/limited.js node examples/runtime/exception-order.mjs
```

The example checks the same trace in source, reloaded source and direct CIL. An
outer filter reads state before an inner finally changes it. The second search
executes a throwing filter and its cleanup, discards that filter's fault, and
continues searching with the original exception. Every VM is stopped afterward.

| Capability | Source and reloaded source | Direct CIL | Regression evidence |
| --- | --- | --- | --- |
| Typed catch selection | Shared framework/user ancestry | Verified type tokens and managed ancestry | `a05-exception-hierarchy`, `a05-source-exception-objects` |
| First-pass filter before caller/callee cleanup | Executable filter frames and second-pass unwind | Filter/endfilter and second-pass unwind | `a05-source-filters`, `a05-04-filter-frames`, `exception-order.mjs` |
| Throwing filter with its own finally | Original exception resumes search after filter cleanup | Same managed search contract | Same runnable example and `a05-runtime-memory-examples` |
| First-chance/unhandled callback replay | Implemented; local and portable replay tested | Same callback-policy and replay contract | `a05-exception-event-policy`; revision-scoped results below |

`tests/a05-runtime-memory-examples.test.js` checks the example through all three
routes. Those cases passed at `d9453a979` in a focused cohort with 40 passes, zero
failures and seven skipped existing .NET reference-pack-dependent compiler cases.
The example cases themselves were not skipped.

The `8cc82866` main-merge repair cohort passed 146/146 cases, including
first-chance/unhandled callback order and local/portable replay in source,
reloaded source and CIL. The
[retained validation manifest](a05-evidence/integration-validation-20261004/README.md)
records those full revisions and log digests. A later 123/123 focused run at
`3ad9a4bd7` (`a05-main349-repairs-r1.log`) includes source/CIL callback lifetime,
cancellation, snapshot rejection and abandoned-initializer cleanup after the
callback lifecycle corrections.

These focused results do not imply that the integration is entirely passing:
the broader `3b482d83b` A05/preemption/security run recorded 3,162 passes, 25 failures and zero skips across
3,187 tests. Authored example traces and local replay tests do not constitute
fresh native CLR evidence. SDK 8/10 callback-policy/cleanup execution and browser
qualification remain independently tracked.
