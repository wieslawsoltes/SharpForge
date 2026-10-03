# Virtual and interface dispatch

T02.1 builds one target vector per closed receiver type. Method declarations map to slot indexes;
`NewSlot` introduces a slot, ordinary overrides reuse one, and `MethodImpl` redirects declarations.
Calls through an inherited declaration therefore preserve hiding and sealed overrides. Abstract targets
raise `MemberAccessException` when invoked. Direct `call` retains its exact declaration target.

T02.2 collects default interface implementation candidates by closed interface identity. Class methods
and explicit implementations take priority. A default is selected only when one declaring interface is
more specific than all competitors. An incomparable diamond remains loadable and raises
`System.Runtime.AmbiguousImplementationException` on invocation. Verifier reachability includes competing
bodies, preventing the runtime from invoking an unverified default method.

The native fixture in `tests/fixtures/a05-default-interfaces` covers default bodies, a diamond resolved
by a more-specific override, class implementations, explicit implementations and derived reimplementation.
The malformed/ambiguous IL fixture is assembled independently of the C# compiler, which rejects an unresolved
diamond before emission. Execution and performance qualification are deferred until the complete E01 scope
is assembled; no native, browser or timing results are claimed here.
