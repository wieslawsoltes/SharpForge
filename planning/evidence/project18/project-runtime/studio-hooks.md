# Prepared Studio entry hooks for project runtime sources

These changes target the protected `apps/studio/studio.js` entry after its lease
is released. They are not applied to that file in this worktree. The helper and
production worker implementation is included in `b7271de1`; the focused helper
tests are `tests/a23-project-debug-sources.test.js`. Final evidence is recorded in
[qualification.json](qualification.json). Do not execute a copied Studio
entry to bypass the active lease.

## Import and services

The exact, assertion-checked transformation is prepared separately at
`/workspace/scratch/3e16369943fd/p18-studio-runtime-patch.py` for the integration
owner's generator. It does not execute JavaScript or write the protected entry.
Editor decoration and source-breakpoint bodies now live in
`apps/studio/debug-editor-decorations.js` and
`apps/studio/debug-source-breakpoints.js`; the entry uses small delegates. The
focused `tests/a23-project-debug-editor.test.js` adds actual UTF-16/CRLF offsets,
bound/requested-line identity, cancellation and stale-session/reply scenarios.
These tests passed in the final affected Node 22 and complete Node 26 scopes.
The existing stop-banner body is separately extracted to `apps/studio/debug-stop-banner.js`
so the frozen debugger tools file also shrinks; its focused banner tests pass in both captures.

```js
import {
  setDebugSources, workspaceFileForDebugSource, debugSourceForWorkspace,
  workspaceDebugPoint, navigateDebugSource
} from './debug-sources.js';

const debugNavigation = {
  state, openFile, getEditor: () => editor,
  showSymbolSource: point => advancedTools.showSymbolSource(point), setPanel
};
```

Construct `debugNavigation` after state exists. Its closures may refer to the
later-created editor and advanced-tools instances; they are evaluated only when
navigating. The helper calls `getEditor()` after opening the document.

## Source lifetime

In the runtime `loaded` event, replace only the map construction with:

```js
setDebugSources(state, event.sources);
```

At launch and stop, replace assignments to `new Map()` and the `debugSources.clear()`
call with `setDebugSources(state, [])`. This also releases the structured source
records and original-URI index. `debugSources` remains a Map from executable URI
to string for the existing verified-source viewer and Portable PDB UI.

The worker now sends `uri`, `text`, optional `version`, `originalUri`, `assemblyKey`,
`project`, `contextId` and `generated`. Keep the executable URI intact.

## Stop and selected-frame navigation

Use `navigateDebugSource(debugNavigation, state.debug.point)` for Show Next
Statement. Use `navigateDebugSource(debugNavigation, frame)` after the existing
session/frame checks in `selectDebugFrame`. Use the same helper with `event.point`
when a new paused state is selected. These calls replace the entire old
`matchesDebugSource` / `openFile` / embedded-source branch.

Preserve the surrounding inspected-thread/frame resets, stale-session checks,
decorations, panel rendering and watch refresh. Remove the final independent
`advancedTools.showSymbolSource(event.point)` fallback from `runtimeEvent`, since
navigation now selects the appropriate workspace or embedded-source view once.

If an execution URI has no current matching workspace file, the helper uses
`advancedTools.showSymbolSource` with that exact URI. It never inserts the
embedded source into editable workspace files or guesses by basename. A direct
CIL frame without source falls back to the disassembly panel.

## Editor painting and breakpoint bindings

Within each editor's decoration loop, resolve display points before painting:

```js
const executionUri = debugSourceForWorkspace(state, uri)?.uri ?? uri;
const bound = current ? state.debug.breakpoints?.filter(item => item.uri === executionUri) : null;
const paintedPoint = workspaceDebugPoint(state, point, uri);
const selectedPoint = workspaceDebugPoint(state, selected, uri);
const snapshot = instance.sourceSnapshot();
const painted = paintedPoint ? {
  ...paintedPoint,
  start: snapshot.offsetAt({line: paintedPoint.line - 1, character: paintedPoint.column - 1}),
  end: snapshot.offsetAt({
    line: (paintedPoint.endLine ?? paintedPoint.line) - 1,
    character: (paintedPoint.endColumn ?? paintedPoint.column + 1) - 1
  })
} : null;
instance.setExecutionLocation(painted, {phase: state.debug?.reason?.phase, description: state.debug?.reason?.description});
instance.setSelectedFrameLine(selectedPoint?.line ?? null);
```

The original runtime points are unchanged; editor display points carry
`executionUri`. The committed DebuggerTools banner and breakpoint-row helper
already use this same resolver.

In `syncBreakpoints(uri)`, derive `executionUri` using the same expression and
send `{uri: executionUri, breakpoints: state.breakpoints[uri] ?? [], sessionId}`.
When replacing returned bindings, filter by `executionUri`; persisted anchors
remain keyed by the workspace `uri`. The existing `toggleBreakpoint` and
`editBreakpoint` lookups should compare their bound breakpoints with that
`executionUri` too. Ambiguous contexts remain unbound rather than selecting an
unrelated generated file.

## Workspace-originating commands

For a paused Run to Cursor, resolve the document before sending its target:

```js
const source = debugSourceForWorkspace(state, target.uri);
if (!source) throw new Error('The active document has no unambiguous matching source in this debug session');
return runtime.request('runToCursor', {...target, uri: source.uri});
```

Use that URI conversion in the `DebuggerExtensions` cursor callback for Set Next
Statement as well. Leave the initial pre-launch cursor target unchanged. For a
paused debugger data tip, replace `matchesDebugSource(params.uri)` with
`debugSourceForWorkspace(state, params.uri)`. The workspace text scan still uses
`params.uri`; evaluation retains the selected frame and existing stale checks.

Remove the old `matchesDebugSource` helper after these call sites are replaced.
`workspaceFileForDebugSource(state, executableUri, point)` is available for any
remaining exact executable-source check.

## Earlier controller hook review

The previously reviewed native constructor fixes remain required: pass
`getTestInput` inside `createNativeContextHooks`' host object, expose the current
test project selection, and call `nativeBuild.contexts.setProject(path)` when
choosing a native startup project. Global Ctrl+F5 calls `nativeBuild.runProject()`;
native debugger attachment remains explicitly unsupported. The project-runtime
launch envelope uses `projectRuntimeDependencies(result)` after launch-option
spread so it cannot be overridden by profile options.
