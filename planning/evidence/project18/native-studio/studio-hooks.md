# Prepared Studio integration hooks

Implementation commit: `6644d340d658062e7eae3f28a6aed94ed23106b0`.
The protected `apps/studio/studio.js` was not edited or executed from a copied
proposal. Root owns applying the reviewed entry-file changes when its live lock
is released. The extracted modules and dockable panels are committed.

## Constructor and compiler requests

Import the following application helpers:

```js
import {
  createNativeContextHooks,
  nativeDocumentReadOnly
} from './native-build/workspace-state.js';
import {
  prepareProjectRequest,
  requestProjectCompilation
} from './project-build.js';
import {navigateWorkspaceDiagnostic} from './workspace-documents.js';
```

Add these callbacks to the existing `MSBuildTools` constructor while retaining
the existing attach, open, save, job, assembly, workspace and error callbacks:

```js
...createNativeContextHooks({
  state,
  stop: stopQuietly,
  resetEditors,
  renderWorkspace,
  scheduleAnalysis,
  status,
  getTestInput: ({signal} = {}) =>
    prepareProjectRequest(state, 'analyze', {signal})
}),
getTestProject: () => state.nativeMode
  ? nativeBuild.contexts.project
  : state.startupProject ?? 'Browser.csproj',
onOpenTestSource: source => navigateWorkspaceDiagnostic({
  state, nativeBuild, openFile, setPanel
}, source)
```

`getTestInput` belongs inside the host passed to `createNativeContextHooks`.
The returned callback uses the selected native context first and calls the
portable source-preparation callback otherwise. Overriding that returned
callback with an unconditional portable request would discard native compiler
references until the evaluator's native delegate is integrated.

The `requestCompiler` delegate becomes
`requestProjectCompilation(state, compiler, method, params)` after the evaluator's
corresponding native-context integration is merged. That helper owns portable
source hydration, target phases, project artifacts and conditional options.

When attaching a new native workspace, clear `nativeProjectContext`,
`nativeContextFiles`, `nativeCompilationOptions` and `nativeAdditionalFiles`
alongside the existing source/editor reset. The proposal already does this.
The original attach callback remains responsible for user-visible workspace
switch decisions; context hydration itself commits only fully read inputs.

## Native launch and project selection

In `launch(debug, options)`, the native path selects the MSBuild panel and calls
`nativeBuild.runProject()` when `debug` is false. Native process attachment when
`debug` is true remains explicitly unsupported. The MSBuild panel supplies its
own cancellation control; process output is retained in its normal output view.

`nativeBuild.profiles` owns selected launch and publish profiles. Listing or
selecting profiles never executes a target. `runProject()` and
`publishProfile()` pass through the existing trust/save gate.

When Solution Explorer selects a native startup project, update both the
existing `state.nativeStartup` / `nativeBuild.settings.project` values and call
`nativeBuild.contexts.setProject(path)`. Launch, test and semantic-context
selection use `contexts.project`. Changing only the old build setting would
leave Ctrl+F5 pointed at the preceding project.

## Generated documents and navigation

Use `nativeDocumentReadOnly(state, file)` for editor creation, opening a file,
global debugger read-only transitions, stop/reset transitions, editor changes,
refactoring admission and edit application. Generated native documents must
remain immutable after debugging ends. The proposal has these guards.

Preserve `readOnly`, `generated`, `hash` and `text` when admitting a native source
returned by `onOpenSource`; `admitWorkspaceSource` accepts that complete record.
The generated record is provided from the context cache when the native host
does not expose it as an ordinary editable file.

`navigateWorkspaceDiagnostic` accepts compiler ranges, absolute offsets or test
`{path, line, column}` locations. Root commit `872a5a93` converts those positions
through `SourceText` and opens compiled sources that have not had an editor tab.
The extracted Error List now delegates to this same helper.

## Static proposal review

Reviewed `/workspace/scratch/3e16369943fd/p18-studio-proposed.js` as text against
the committed controllers. The review did not execute a substitute for the
locked entry file. Three integration mismatches were reported to root:

1. The standalone constructor `getTestInput` overrode the native-aware callback;
   move it into the hook host as shown above.
2. The constructor omitted `getTestProject`; add the selected startup project
   callback to preserve project-qualified portable TestCase identifiers.
3. Native Explorer startup selection changed only the old build settings;
   update `contexts.project` through `setProject` as well.

Root acknowledged all three corrections. The context reset, generated-document
guards, source navigation and native Ctrl+F5 branch otherwise match the helper
contracts. Executable launch profiles use native commit `4f237a43` and remain
restricted to the granted workspace; this UI does not accept arbitrary external
executables.

## Qualification boundaries

The completed Node22 and Node26 batches pass 106/106 tests each. The retained
Chromium run passes 12/12 checks using production modules/CSP and real portable
source/CIL workers. Its native transport is explicitly a fixture. No real
framework installation, testhost PID, coverage collector, Windows/macOS native
run or applied Studio entry-file integration is claimed by that browser run.
The earlier shared native framework qualification gaps remain in `testing.json`.

Final aggregate `npm run check` still needs root's reviewed dynamic-import
content-hash inventory update. No CSP rule was broadened, no structure baseline
was relaxed and no root manifest or protected runtime dispatcher was edited by
this UI batch.
