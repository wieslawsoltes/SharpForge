# Studio binding diagnostics and phased rendering

This successor completes the Studio host seams for **SF-A15-T04.8 (#1786)**
and **SF-A15-T05.4 (#1790)**. It uses the existing binding engine, application
sessions, dispatcher queue and rendering scheduler. The newly authored fixtures
have not been executed; they join the next complete-scope qualification.

## Binding output

`RuntimeUIBridge.runtimeOptions()` supplies `uiServices.bindingDiagnostics` to
each candidate VM. Existing explicitly supplied observers still receive the
record; an observer exception cannot escape into a managed binding. A candidate
buffers diagnostics until its runtime session is committed. Disposing a failed
candidate or replaced session discards its pending records.

The worker copies the stable SFB001–SFB010 code, source type, binding path, path
step and target property. It forwards fixed diagnostic messages and the
`valuesRedacted` marker. Converter exceptions, arbitrary callback fields, source
objects and source values do not cross this channel. Sensitive property/path
names receive the same generic redaction message as the binding engine.

Each flush contains at most 128 distinct records. Repeated pending records share
an occurrence count, and excess records produce an omitted count. Path, type and
property strings have explicit limits; a truncated identity is marked. The
existing bounded OutputChannels store limits retained output independently.

`AppSession` accepts a packet only from its current worker generation and runtime
serial. The application's **Bindings** output channel preserves this identity
in every entry alongside the structured diagnostic. Console output remains its
own channel, so debugger output snapshots and rewind do not erase or duplicate
binding messages. A fresh launch clears the application's binding channel;
removing the application releases it.

## Host frames and x:Phase

The managed phase scheduler receives a `requestFrame`/`cancelFrame` capability
from its own runtime bridge. Callbacks remain in the worker. One coalesced
`bindingFrame` request asks the browser's shared `FrameScheduler` for a frame
number and timestamp. The browser sends that acknowledgement only when the host
scheduler ticks; there is no worker timer advancing the phase queue.

The worker then queues the callback through `ManagedUIWorkQueue`, preserving UI
dispatcher access, interpreter isolation and debugger pause boundaries. The
existing `BindingPhaseScheduler` advances one ascending phase per callback.
Callbacks enqueued while a batch runs wait for another host acknowledgement.
The bridge permits at most 4,096 callbacks and delivers at most 64 owner queues
per acknowledgement; each owner retains its existing per-phase work budget.

Pause cancels the outstanding host request and retains pending callbacks. Resume
requests a fresh frame. Phase cancellation, root disposal, session replacement
and worker shutdown discard obsolete callbacks or acknowledgements. A malformed
host acknowledgement reports an explicit error and stops that frame service.
An explicitly configured frame provider is preserved. The ordinary JavaScript
facade continues to use its already shared host scheduler.

Legacy source-image launches can supply `bindingAssembly` with the matching
emitted assembly, independently of `image`. This supplies the authoritative
metadata required by x:Bind while retaining source-image execution. Assembly
reload and direct-CIL launches continue to use their existing assembly bytes.

## Authored qualification

- `tests/a15-studio-binding-diagnostics.test.js` covers the ten stable diagnostic
  codes, redaction, bounded output, disposal and real source/reload/CIL workers
  delivering failures to actual AppSession output channels.
- `tests/a15-studio-binding-frames.test.js` covers bounded callback dispatch,
  pause/cancellation and the actual worker/Studio bridge with a controlled host
  frame boundary. Its C# fixture checks ascending phases and deferred FindName
  construction. This Node fixture does not claim native browser evidence.
- `tests/browser_a15_binding_services_test.py` launches all three engines in the
  built Studio with real workers, retained hosts and native browser RAF. It
  observes the actual frame acknowledgement packets, asserts separate ascending
  frames, checks Studio binding output and clicks the managed realization button.

At the coordinated qualification slot, run the A15 node scope through
`node scripts/limited.js`, then run `python tests/browser_a15_binding_services_test.py`
against the built Studio HTTP harness. The browser script is registered in the
A15 manifest and writes `a15-binding-services.json` only from its actual run.
