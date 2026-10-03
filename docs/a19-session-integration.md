# A19 session recovery and runtime settings integration

## Recovery and export

Compose `new SessionRecovery(workbenchServices)` from `apps/studio/workbench/session-recovery.js`. Its `export()` returns `{startupConfiguration, launchProfiles}` with versioned startup order, actions and selected profile metadata. Merge those two fields into existing recovery and workspace settings objects. ZIP and folder manifests preserve them through the project-system settings contribution table.

For an incoming workspace, evaluate its project definitions without replacing the current workspace, then call:

```js
const prepared = recovery.prepare(settings, { projects: prospectiveDefinitions });
// Only after this succeeds, install the records/project system and synchronize its services.
projectServices.sync();
recovery.apply(prepared);
runtimeBridge.select(null);
```

Prospective definitions use the same `{id, outputType}` or `{path, outputKind}` identity/kind pairs registered with BuildServices. The token is immutable and single-use; applying it to a changed project set fails with `SESSION_RECOVERY_STALE`. Validation rejects missing projects, launchable library entries and missing profile references before either live settings owner changes. Both owners commit before subscribers are notified. A record without either metadata field is a no-op. A missing field does not replace that owner.

For the currently loaded workspace, `prepare(settings)` derives actual project definitions; `restore(settings)` combines preparation and application. Imports never reconstruct arguments, environment values, network origins or enable flags. Imported profiles receive denied networking and empty executable argument/environment data. Existing in-memory profiles keep their grants when a partial import does not replace the profile owner. Profiles and startup snapshots must be persisted after project synchronization; do not store the service objects, active runtime settings or workers.

## Runtime tool settings provider

```js
const runtimeBridge = createRuntimeToolsBridge({
  services: workbenchServices,
  state: () => state,
  getProjectId: () => projectServices.currentProjectId,
  save: saveLocal,
  onChanged: () => refreshRuntimeTool()
});
const runtimeTools = new RuntimeTools({
  state: runtimeBridge.state,
  settings: runtimeBridge,
  request: (...args) => runtimeBridge.request(...args),
  build: () => runtimeBridge.build(),
  save: saveLocal,
  toast
});
```

The bridge follows the current project's selected profile until `select({projectId, profileId})` or `select({sessionId})` pins a target. The settings form renders an explicit target selector. Profile edits affect that project's next start, while application edits affect that application's next restart. Neither changes a running worker's current capability snapshot or another application's settings. `select(null)` resumes following the project; call it after replacing a workspace. A removed explicit target becomes unavailable and refuses writes until another target is selected.

`settings()`, `configure(patch)`, `launchOptions(target?, profileId?)` and `revoke()` retain the legacy RuntimeTools API. `context()` and `targets()` describe the current settings target without changing the active debugger application or startup selection. The explicit state adapter contains only `runtimeSettings`, `langVersion`, `projectSystem`, `readOnly` and read-only `debug`. Its debug value is taken from the associated application, with the same composite identity as the shared compatibility facade.

The orchestrator already obtains the complete options from each launch profile. Its host `launchOptions` callback must supply only orthogonal debugger settings or function breakpoints; do not spread a global `runtimeTools.launchOptions()` into that callback. An explicit managed method invocation can use `runtimeBridge.launchOptions({projectId})` to obtain that project's network and compute settings without replacing the method's raw parameter vector. The bridge does not add program arguments or environment data to explicit method calls.

`request()` captures the associated application and refuses a foreign active-session fallback. `revoke()` clears the selected target's future grants synchronously. `revokeAndStop()` also stops only the selected application, or all instances of the selected project/profile, and clears their future grants. Changing execution settings causes no source rebuild. An actual loose-source language change invalidates only its build service; `build()` consumes that pending work. A project language version remains owned by its `.csproj`.

## Direct debug-state write gate

`scripts/quality/session-state-ownership.js` can scan every Studio JavaScript module using the existing lexical tokenizer. Direct `state.debug` writes are permitted only in its exact application-state/compatibility ownership inventory. There are no legacy Studio exceptions. The guard recognizes dot/computed writes, assignment operators, updates, deletion and destructuring while excluding reads, comparisons, comments and string contents. It is a lexical boundary check, not alias or data-flow analysis.

The sessions/runtime review retains its three independent checker cases in
`tests/a19-session-state-ownership.test.js`. The final composition layer installs
`tests/a19-state-ownership.test.js`, whose fourth case scans the actual integrated
Studio tree. This layer does not claim that the pre-composition Studio root has
already transferred its state to session ownership.
