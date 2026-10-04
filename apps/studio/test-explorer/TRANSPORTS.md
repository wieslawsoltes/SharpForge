# Studio test adapter transports

`PortableWorkerTestAdapter` starts its worker only when discovery or execution is
requested. The worker retains compiler symbols and discovery state; the UI
receives structured test records, diagnostics, streamed results and a discovery
identifier. Each managed run owns a fresh source or direct CIL session.

Discovery accepts hydrated source records plus project compilation options,
including preprocessor constants. Requests have bounded source counts and text,
reject overlapping work and validate the discovery identifier before execution.
Cancellation keeps the response channel alive for orderly final results; an
unresponsive worker is terminated after the bounded cancellation grace period.
`close()` releases the worker and rejects further operations.

`NativeClientTestAdapter` uses the authenticated `testing` service contribution.
It starts a server session, polls events by cursor, forwards cancellation as soon
as the session identifier is available, and reads only retained result artifacts.
Artifact decoding is chunked and rejects responses above its 48 MiB bound.

This complete composition registers native testing alongside the existing SDK,
workspace, context and profile services. Hosts below this layer can still opt in
with `registerNativeTestingServices`. A host that uses this default composition
must not register that same contribution twice.

## Evidence and boundaries

The five portable protocol cases execute the actual source and CIL test runtimes
through a structured-clone transport fixture. The two native client cases retain
start/poll cursor, immediate cancellation and artifact assertions from the
completed 106-test native UI scope on Node 22 and Node 26. These are transport
fixtures, not a claim of installed Microsoft test frameworks or native test-host
qualification. Separate Chromium qualification covers the real browser worker.

The one bounded external framework restore produced no packages before its
50-second timeout. Native framework, coverage collector and operating-system
qualification remain open. The full Test Explorer view and Studio panel wiring
are dependent composition layers.
