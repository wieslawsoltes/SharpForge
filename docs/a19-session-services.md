# Workbench document, build and application services

The A19 service layer gives each project its own compiler worker and each launched
application its own runtime worker. `createWorkbenchServices` in
`apps/studio/workbench/sessions.js` owns their lifetimes. Two workbench instances
can coexist without sharing documents, selections, cancellation, diagnostics,
output, runtime grants or application windows.

## Composition

```js
import { createWorkbenchServices } from './workbench/sessions.js';
import { ApplicationWindows } from './workbench/application-window.js';

const services = createWorkbenchServices({
  records: sourceFiles,
  projects: projectDescriptors,
  getProjectSnapshot: projectId => projectSnapshot(projectId),
  createEditor: (record, options) => createSourceView(record, options),
  saveDocument: record => saveCapturedSource(record),
  onError: error => reportError(error),
  onReveal: panelId => docking.activate(panelId)
});
const windows = new ApplicationWindows({
  sessions: services.sessions,
  registerPanel: panel => docking.registerPanel(panel),
  unregisterPanel: id => docking.unregisterPanel(id),
  confirmStop: session => confirmStopApplication(session),
  onError: error => reportError(error)
});
services.startup.configure({
  mode: 'multiple',
  entries: [
    { projectId: 'AppA/AppA.csproj', action: 'start', order: 0 },
    { projectId: 'AppB/AppB.csproj', action: 'startWithoutDebugging', order: 1 }
  ]
});
const result = await services.launches.start();
// result.started contains application IDs; failed/cancelled remain explicit.
```

Project descriptors identify `id` (or `path`), `name`, `outputType`, `dependencies`
and a snapshot containing `files`, `compilationOptions`, `assemblyName` and optional
`loadingDiagnostics`. Dependencies are built first; a failed independent startup
root does not prevent a later root from launching. Unknown dependencies and cycles
produce explicit errors. Cancellation terminates the affected compiler worker,
which also interrupts synchronous compiler work.

Without a custom snapshot provider, project build snapshots read current document
text and versions instead of the original descriptor text. Concurrent launch
operations share the project's build queue while retaining separate app workers.

Document factories receive `{viewId,onChange,onFocus}` and return
`{editor,element}`. `DocumentService` synchronizes all views of one document while
retaining independent selection and scroll snapshots. It rejects dirty closes;
the document-tab host owns Save/Discard/Cancel dialogs. Save captures a source
revision and never marks an edit made during the write as saved.

## Identity and the legacy Studio adapter

Runtime workers each start their numeric wire `sessionId` at one. Numeric values
therefore cannot identify a workspace application. An application identity is:

```text
application id : worker generation : numeric runtime session id
```

`AppSession.identity`, every session event, and `debug.identity` expose this value.
The raw worker number remains in `AppSession.runtimeSession`. `legacyDebug` and
`legacyRuntimeEvent` expose the composite value as legacy `sessionId`, with the
numeric number retained in `runtimeSessionId`. `createRuntimeFacade` captures the
selected application synchronously, rejects another application's identity, and
translates a valid identity back to the numeric wire field. Existing asynchronous
UI operations can continue comparing their captured `state.debug.sessionId`.

`services.createStateFacade(initialState)` returns a plain object with explicit
property descriptors. The descriptors route document, artifact and debugger fields
to their current owners; `stateSlices` exposes the remaining documents, build,
sessions and UI records. No prototype patch or request-method replacement is used.
The worker client's optional constructor `transformRequest` is an explicit seam.

The root Studio adapter should:

1. Replace the singleton `WorkerClient` instances with `services.compiler` and
   `services.runtime`, and the state literal with `createStateFacade`.
2. Register every project and its source membership; call `documents.update` on
   edits so only affected project revisions invalidate.
3. Use `builds.get(projectId).build/analyze/request` for scoped operations.
4. Send runtime events through `routeSessionEvents`; only active-session state and
   output callbacks redraw shared debugger tools. All app UI events go to their
   own `ApplicationWindows` host.
5. Apply `DocumentLocks`, which preserves editability of unrelated projects.
6. Dispose application windows, then the services, when closing the workbench.

## Tool and shell adapters

| Adapter | Responsibility |
| --- | --- |
| `OutputChannels` | Named Build, Build Order, Debug, MSBuild, Designer, Tests and per-app Program panes; bounded ring buffers and viewport reads |
| `DiagnosticsStore` | Independent build, analysis, project-loading and designer producer revisions per project |
| `BuildQueue` | Dependency order, per-operation/project cancellation and succeeded/failed/skipped/cancelled summaries |
| `RevealPolicy` | Visibility requests require current explicit user intent; background work cannot select tools |
| `SessionBreakpoints` | One user list per project, per-app binding state and updates only to matching project sessions |
| `SessionSettings` | Exact-origin grants and compute options per app; revoke stops only the affected app |
| `StartupConfiguration` | Single, multiple and current-selection startup; deterministic serialization |
| `LaunchProfiles` | Project-local launch options with copy isolation; export omits environment values, arguments and grants |
| `createStartupDialog` / `mountStartupTarget` | Startup ordering/actions and toolbar target/profile selection |
| `mountProcesses` | App-scoped Break, Continue, Stop, Detach and Restart plus worker/heap observations |
| `DebugLocation` / `mountDebugLocation` | Process/thread/frame selection with stale-response checks |
| `projectDecoration` | Startup/build/running/paused badges and accessible project descriptions |
| `sessionStatus` / `mountSessionStatus` | Combined state/count and non-repeating live-region announcements |

Origin and compute changes apply to the next launch of that app; the current worker
retains its launch policy. Revocation stops that worker session immediately.
Exports contain neither network grants nor environment values. Browser CSP and
server CORS still determine whether an otherwise granted request can complete.

The current runtime worker does not implement live policy replacement, native
process attachment, or operating-system environment injection. Managed IL supports
profile arguments. Source VM arguments and per-app environments require an explicit
`launchCapabilities(projectId, profile, built, launch)` host callback returning the
supported `arguments` and `environment` flags. Unsupported nonempty options fail
with `LAUNCH_CAPABILITY` before application launch. `launchOptions` supplies the
actual target settings; capability flags must match that implementation.
Detach disables source/data/exception break
handling and continues the selected managed browser process; it is not OS process
detachment. Renderer metrics identify the actual backend rather than claiming that
a fallback rendered through WebGPU.

## Validation

The focused Node files are `a19-worker-client.test.js`,
`a19-documents-state.test.js`, `a19-build-output.test.js`,
`a19-app-sessions.test.js` and `a19-startup-orchestration.test.js`. Their fake Worker
is explicitly a protocol/lifetime test, not compiler or native parity evidence.

`tests/browser_multi_session_test.py` builds two actual C# WinUI applications with
separate real compiler and runtime workers, checks their rendered panels and output,
closes only one, and verifies diagnostic isolation while the other remains alive.
It requires the HTTP harness. The in-memory Blob loader must instead receive
rewritten worker URLs from the host; this script does not claim to qualify it.
