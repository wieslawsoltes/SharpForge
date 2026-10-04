# Native Studio models

The native context and profile models receive their workspace, transport, request
builder, operation/cancellation boundary, rendering callback, and commit callback
through an explicit host object. They do not construct a controller, access a DOM
element, or initiate a process at module load.

## Project contexts

`NativeProjectContexts` selects a project from `host.workspace.projects`, obtains
its evaluated contexts through `host.client.projectContexts`, and hydrates the
selected source and reference records before publishing an active compilation.
The public `@sharpforge/msbuild` compilation adapter supplies compiler options;
the UI model does not duplicate native evaluation.

`host.operation(label, action)` owns the cancellation signal and trust boundary.
`host.attach()` ensures the requested native workspace is attached. The model
awaits `host.onProjectContext({context, compilation, signal})` before activation
and rejects an obsolete generation or cancellation. A failed read preserves the
previous complete selection; changing projects clears it and resets profiles.

Reference decoding checks the context identity, unique paths, at most 512
references, 8 MiB per reference, and 32 MiB total by default. It validates Base64,
declared byte counts, and SHA-256 when supplied. Large Base64 payloads are decoded
in bounded chunks with cancellation and event-loop yields. Hydration also bounds
the source set to 20,000 records and 32 × 1,024 × 1,024 UTF-16 code units of text.

`settings.js` retains the existing native request, delay, action-reporting and
artifact-download helpers so the context model and later controller share one
implementation. Advanced build arguments remain a JSON string array, separate
from application arguments.

## Launch and publish profiles

`NativeProjectProfiles.refresh()` reads launch settings and publish-profile
descriptions through the connected transport. Its operation explicitly requests
`{trust: false, save: false}`: inspection does not attach, save, restore, build, run
or publish. Cancellation and an obsolete project reject before changing the
published model. At most 1,024 publish profiles are admitted.

`runRequest()` and `publishRequest()` return request data for a separate explicit
host action. Launch requests preserve argument boundaries, environment variables,
application URLs, working directories and active context identity. Unsupported
launch commands, malformed settings and stale selections report errors before an
executable request can be produced. Publish properties stay inspection-only until
the native host evaluates the selected profile under its normal trust boundary.

## Qualification boundary

The direct model tests use explicit in-memory transport callbacks. They cover
hydration, selection, failed reads, cancellation, stale generations, requests and
reference validation. Controller trust enforcement, native process execution and
full Studio entry integration remain in their respective integration suites.
The original controller tests remain unchanged; the direct metadata regression
is extracted without changing its assertions.
