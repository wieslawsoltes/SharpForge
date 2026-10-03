# Managed calls and exception control

The direct CIL engine resolves MethodDef, MemberRef and MethodSpec calls using the closed declaring type and method arguments. Concrete frames retain substituted arguments, locals and signatures. Generic constraints are checked when a concrete method frame is created. Virtual slots include the declaring type instance, so explicit implementations of `I<int>` and `I<string>` remain separate. Existing `newslot`, override and final-slot behavior is retained. Internal implementations of external interface declarations, including `IDisposable.Dispose`, dispatch through the same declaration slots.

`ldftn` and `ldvirtftn` produce immutable function pointers owned by one VM. Managed `calli` requires a matching StandAloneSig and rejects native calling conventions or foreign pointers. Delegates support open and closed instance targets, static targets, ordered multicast invocation, equality, combination, invocation-list enumeration, and removal of the last matching subsequence. Multicast return values come from the final target; an exception stops the remaining targets.

`constrained.` dispatch passes a value receiver by managed reference when the value type implements the target method. Reference receivers are dereferenced, and the object fallback boxes a value copy. `tail.` reuses the current frame after argument preparation and rejects references to locals whose frame would expire. Managed ref/out arguments preserve storage identity; in arguments carry a readonly pointer. Returning an address into a completed local frame fails deterministically.

Exception handling follows the two-pass model in [ECMA-335, I.12.4.2](https://ecma-international.org/publications-and-standards/standards/ecma-335/): search and filters run across frames before finally/fault cleanup. Filters evaluate with the declaring frame's args and locals while younger frames remain live. An exception escaping a filter counts as false. Once a handler is selected, cleanup runs from the youngest frame outward. A new exception raised by cleanup starts a new search. Rethrow preserves the original managed fault and reference. Fault handlers run only for exceptional exits; finally handlers also run for leave.

Filter state, multicast continuations and generic frame identity are snapshot state. Exception and delegate root enumerators retain their heap references while paused. Filter clones share the original args and locals arrays; snapshots preserve that aliasing. Resource-limit failures retain the existing fatal-fault policy.

Native examples are in `tests/fixtures/a05-calls` and `tests/fixtures/a05-exceptions`. After the complete E01 scope is assembled, run `node scripts/validate-a05-control.js --dotnet /path/to/dotnet`. The runner compiles each program once, executes the same DLL with native .NET and CIL, compares stdout and exit status, and writes hashes and toolchain evidence under `artifacts/a05-control`. Independent metadata fixtures in `tests/a05-02-calls.test.js` and `tests/a05-04-exceptions.test.js` cover tail calls, fault clauses, malformed prefixes/regions, pointer ownership/lifetime, filter snapshots and readonly boundaries that C# cannot emit directly.

Native pointers, unmanaged calli, varargs, typed references, and pinned locals remain outside this managed profile. These features are rejected explicitly; accepted managed pointers never expose host memory addresses. The source C# parser's surface remains a separate capability from direct CIL execution.

| API / instruction surface | Direct CIL target | Source target |
| --- | --- | --- |
| MethodSpec, virtual/interface slots, constrained value receivers | Implemented; native fixture supplied, E01 qualification pending | Source parser support remains separately inventoried |
| ldftn, ldvirtftn, multicast Delegate operations, managed calli | Implemented; opaque VM-owned targets | Existing source/platform delegates retain their adapter |
| ref/out/in, tail., byref returns | Implemented with readonly and lifetime checks | General source syntax remains outside this change |
| Filters, fault/finally, rethrow, cross-frame search | Implemented; native cleanup/filter traces supplied | Existing catch/finally IR unchanged |
| Native pointers / unmanaged calli / varargs | Explicitly rejected | Unsupported |

Run `node scripts/benchmark-a05-control.js` after correctness qualification to record cold/warm execution latency, p95/p99, managed allocations and allocated bytes for direct calls, tail calls and exceptional search/unwind. The script asserts each result before including a sample. Native/browser evidence and exact integration commits are recorded by the epic qualification; this implementation document is not a test result.
