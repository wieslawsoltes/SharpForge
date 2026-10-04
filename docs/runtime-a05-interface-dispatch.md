# Interface default implementations

This [T02.2](https://github.com/wieslawsoltes/SharpForge/issues/1355) increment
builds on T02.1's virtual-slot vector. It adapts assembled E01's interface
candidate resolution to the existing nongeneric declaration model.

InterfaceImpl inheritance and MethodImpl overrides feed one candidate map per
declaration slot. A class implementation takes precedence. Otherwise a unique
most-specific interface owner supplies the method. Incomparable candidates
remain an ambiguity marker until invocation, which raises managed
`System.Runtime.AmbiguousImplementationException`. All competing executable
bodies are included in verifier reachability. An abstract re-declaration can
suppress a default implementation; absent implementations remain diagnostics.

Public class virtual methods participate in implicit implementation. Private
bodies require MethodImpl, and a derived class's new slot changes an inherited
interface map only when that class reimplements the interface. A new interface
declaration retains its own slot. Interface maps point into the same immutable
target vector as class dispatch; no second type model or snapshot state is added.

Precise interface initialization occurs at entry to the selected implementation,
using an `interface-method` trigger. Dispatch through a base declaration does not
initialize that interface when a class or derived interface supplies the body.
See the [C# interface rules](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/interfaces).

| Capability | Scope |
| --- | --- |
| Direct CIL interface calls | In-assembly nongeneric explicit, implicit, default and diamond dispatch |
| Runtime faults | AmbiguousImplementationException; existing abstract and incompatible-receiver failures |
| Generic/external interfaces | Remain outside this increment and open under T02 |
| Source, browser and Rust/Wasm | No new lowering or independent qualification claimed |

Prepared tests cover ordering-independent selection, repeated inheritance,
reimplementation, private bodies, independent new slots, re-abstraction,
ambiguous calls, malformed competing IL and snapshot replay. The runnable
Roslyn/.NET 10 fixture covers valid default, most-specific, implicit, explicit
and reimplemented calls, including selected-body initialization order:

```sh
dotnet run --project tests/fixtures/a05/default-interfaces/DefaultInterfaces.csproj
```

Serial validation at `0c995ef2` passed all 54 tests in interface-dispatch,
virtual-slots, B03 dispatch, statics and token-cache suites under Node 24.21.0,
one worker and a 512 MB heap cap. Static/manifests and build validation use
the required core check. The native fixture and benchmarks have not run.
Qualification and latency/allocation measurements remain in the root queue;
the full issue stays open for remaining generic and external call prerequisites.
