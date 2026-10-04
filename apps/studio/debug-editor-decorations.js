import {debugSourceForWorkspace, workspaceDebugPoint} from './debug-sources.js';

/** Paint only verified current text, converting one-based execution positions to editor UTF-16 offsets. */
export function decorateDebugEditors({state, editors, updateBanner}) {
  const debug = state.debug;
  const current = debug && !state.buildDirty && debug.profile !== 'managed-il';
  const point = debug?.state === 'paused' ? debug.point : null;
  const frames = [...(state.inspectedThreadFrames ?? []), ...(debug?.frames ?? [])];
  const frame = frames.find(item => item.id === state.frameId);
  const selected = frame && frame.id !== debug?.frames?.[0]?.id ? frame : null;
  for (const [uri, editor] of editors) {
    editor.setDiagnostics((state.result?.diagnostics ?? []).filter(item => item.uri === uri));
    const executionUri = debugSourceForWorkspace(state, uri)?.uri ?? uri;
    const bound = current ? debug.breakpoints?.filter(item => item.uri === executionUri) : null;
    const breakpoints = (state.breakpoints[uri] ?? []).map(request => {
      const binding = bound?.find(item => item.requestedLine === request.line
        && (item.requestedColumn ?? 1) === (request.column ?? 1));
      return {...(binding ?? {...request, verified: current ? false : undefined}),
        muted: state.debugSettings.breakpointsEnabled === false};
    });
    editor.setBreakpoints(breakpoints);
    const display = workspaceDebugPoint(state, point, uri);
    const selection = workspaceDebugPoint(state, selected, uri);
    const snapshot = editor.sourceSnapshot();
    const painted = display ? {...display,
      start: snapshot.offsetAt({line: display.line - 1, character: display.column - 1}),
      end: snapshot.offsetAt({line: (display.endLine ?? display.line) - 1,
        character: (display.endColumn ?? display.column + 1) - 1})} : null;
    editor.setExecutionLocation(painted, {phase: debug?.reason?.phase, description: debug?.reason?.description});
    editor.setSelectedFrameLine(selection?.line ?? null);
  }
  updateBanner();
}
