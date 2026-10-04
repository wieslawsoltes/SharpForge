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
import { EditorModel } from '@sharpforge/editor';

const services = createWorkbenchServices({
  records: sourceFiles,
  projects: projectDescriptors,
  getProjectSnapshot: projectId => projectSnapshot(projectId),
  createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version }),
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

Document factories receive `{viewId,model,onChange,onFocus}` and return
`{editor,element}`. With `createModel` (also accepted as `modelFactory`),
`documents.models` is a stable map of authoritative models for all documents.
Every view receives the same model through `setModel(uri, model)`, sharing its
buffer and undo history while retaining independent selection and scroll snapshots.
The factory should pass `model` directly to `CodeEditor` and omit full-text change
callbacks. The service subscribes once to each model and emits `changed` events
containing the original `change` with immutable `before`/`after` snapshots and
incremental `changes`. Compatibility `previous` and `text` fields remain lazy
through event delivery. Record `text` reads are lazy; assigning text applies an
undoable model edit. `version` is a read-only getter of the model version.

Without a model factory, the original string record and `onChange` factory
contract remains available. Dirty closes are rejected; the document-tab host owns
Save/Discard/Cancel dialogs. Save runs the active view's `prepareSave` before
capturing text/version, and never marks an edit made during the write as saved.
Project locks also set `model.readOnly` for unopened documents, so transactional
workspace edits use the same lock policy as visible source views.

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

Both source and direct CIL launches support profile arguments and isolated,
read-only application environments. `LaunchProfiles.launchOptions()` emits
`programArguments` for Main's flat argv; `arguments` remains reserved for raw
explicit CIL method parameters. The compiler's startup wrapper forwards argv after
module initializers, including across async Main. Applications read supplied values
using `System.Environment.GetEnvironmentVariable(string)`; missing names return
null, empty strings are preserved, and names are case-sensitive. Values are copied
when the runtime is created and are never inherited from the host OS.

The built-in capability record enables `arguments` and `environment` and disables
`environmentMutation`. A different target can override
`launchCapabilities(projectId, profile, built, launch)` with its actual capability
record. Unsupported nonempty options fail with `LAUNCH_CAPABILITY` before launch.
Both the profile editor and runtime use the exported runtime validators and bounds;
malformed replacements preserve an already paused session. `launchOptions` supplies
the actual target settings; capability flags must match that implementation.

The worker does not implement live policy replacement, native process attachment,
environment mutation or OS/user/machine environment injection.
Detach disables source/data/exception break
handling and continues the selected managed browser process; it is not OS process
detachment. Renderer metrics identify the actual backend rather than claiming that
a fallback rendered through WebGPU.

### Active application inspection

`DebuggerExtensions` accepts `sessions` and
`getApplicationWindows: () => applicationWindows` from the Studio composition.
The getter may return `null` before application windows are mounted. With these
services, renderer selection, metrics and `uiSettled()` use the selected session's
existing `ApplicationWindows` host; the debugger does not construct another host
or apply the runtime's command stream twice. Opening the legacy WinUI tool brings
the selected application's document window forward. Background tool refreshes
preserve the focused document.

Live Visual Tree requests capture both the application object and its complete
worker/runtime identity. Selection, restart, stop and disposal invalidate pending
requests and clear the old snapshot, including selected object IDs that may be
reused by another application. `DebuggerExtensions.dispose()` releases inspection
subscriptions and requests without disposing application-owned windows. The
composition must call it when releasing the debugger. An embedding that supplies
no SessionManager retains the existing standalone, single-host behavior.

`tests/a19-application-inspector.test.js` exercises the actual debugger automation,
session manager and worker-client contracts with controlled protocol replies and
renderer boundaries. It covers late scenes, equal runtime serials, restart,
disposal, background focus preservation and the standalone host. These focused
unit boundaries do not claim browser layout, rendering or CSP qualification.

## Validation

The focused Node files are `a19-worker-client.test.js`,
`a19-documents-state.test.js`, `a19-build-output.test.js`,
`a19-app-sessions.test.js`, `a19-startup-orchestration.test.js` and
`a19-document-models.test.js`. The model integration suite uses the actual
`EditorModel` and checks lazy snapshots across one-megabyte document edits,
shared undo, save races and locks on unopened documents. Their fake Worker
is explicitly a protocol/lifetime test, not compiler or native parity evidence.

`tests/browser_multi_session_test.py` loads `TwoApps.slnx` and two C# projects
through the running Studio's `loadDiskRecords` API. It uses Studio's existing
workbench services and application windows. The fixture selects distinct profiles
through the startup toolbar, starts both projects with the actual Start button,
checks their rendered docking panels and exact argv/environment output, switches
the shared debugger through its Process selector, and stops only that application.
It then checks a failing background build in the other project, starts another
instance through the registered command, and stops all sessions. These checks also
cover selected-project preservation, independent document locks and panel disposal.
The fixture uses the shared supported browser launcher and production HTTP/CSP;
the in-memory Blob loader is explicitly rejected. Its result JSON records the
selected engine and failure or completion, including checks completed before a
failure. Browser execution remains pending until run on an installed supported
engine; authoring or syntax-checking this fixture is not browser qualification.

`tests/a19-multi-session-fixture.test.js` uses the same C# window source with real
compiler output and two real runtime worker modules in each JavaScript engine. It
checks the combined WinUI scene, argv, environment and stop-isolation behavior.
Its Node message transport adapter does not qualify Studio DOM, toolbar routing,
docking or browser CSP; those are the separate browser fixture's responsibilities.

`a19-runtime-arguments.test.js`, `a19-runtime-environment.test.js` and
`a19-runtime-worker-launch.test.js` execute real compiler output in both JavaScript
runtimes. Independent CIL fixtures cover the argv and environment ABI without a
SharpForge debug payload. The production worker is adapted only at the Node message
transport; tests cover two simultaneous workers, equal local serials, stop isolation
and malformed replacement launches. Runtime option boundaries and existing builtin
ID locks are checked separately. Native and Wasm execution are not represented by
these tests.
