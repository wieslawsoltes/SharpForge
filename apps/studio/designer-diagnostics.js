const statusCodes = Object.freeze({ missing: 'SFSYNC_MISSING', conflict: 'SFSYNC_CONFLICT', blocked: 'SFSYNC_BLOCKED' });

export function captureDesignerTarget(view, uri = view.sourceSync?.session?.analysis.uri ?? view.path ?? view.state.active) {
  return view.diagnostics?.capture(uri, { projectId: view.state.startupProject });
}

function warnings(sync) {
  return (sync?.session?.analysis.warnings ?? []).map(item => ({ ...item, severity: item.severity ?? 'warning' }));
}

/** Keep the existing designer status and toast while publishing errors against their captured source, not the active editor. */
export function reportDesignerError(view, error, target = captureDesignerTarget(view)) {
  if (target && !view.diagnostics.current(target)) return false;
  view.lastDiagnosticError = error;
  view.status = error.message ?? String(error);
  view.toast(view.status, 'error');
  if (view.statusElement) view.statusElement.textContent = view.status;
  if (target) {
    const sync = view.sourceSync;
    const items = sync?.session?.analysis.uri === target.uri ? warnings(sync) : [];
    view.diagnostics.publish(target, [...items, {
      code: error.code ?? 'SFSTUDIO_DESIGNER', message: view.status, span: error.span, severity: 'error'
    }]);
    if (sync?.session?.analysis.uri === target.uri) sync.diagnosticTarget = target;
  }
  return true;
}

export async function runDesignerAction(view, action) {
  const sync = view.sourceSync;
  const generation = sync?.generation;
  const target = captureDesignerTarget(view);
  try { return await action(); }
  catch (error) {
    if (view.lastDiagnosticError === error || sync?.generation !== generation) return null;
    reportDesignerError(view, error, target);
    return null;
  }
}

export function scheduleDesignerSync(sync, operation, delay) {
  const generation = sync.generation;
  return setTimeout(() => sync[operation]().catch(error => {
    if (generation === sync.generation) sync.report('blocked', error.message);
  }), delay);
}

/** Successful synchronization emits its real protected-expression warnings; stale work cannot replace a new link's diagnostics. */
export function reportDesignerSync(sync, state, message, target) {
  const view = sync.view;
  if (target && !view.diagnostics?.current(target)) return false;
  sync.state = state;
  sync.message = message;
  view.chrome?.renderSync();
  view.status = message;
  if (view.statusElement) view.statusElement.textContent = message;
  if (!view.diagnostics) return true;
  if (state === 'unlinked' || state === 'source-dirty') {
    view.diagnostics.clear(sync.diagnosticTarget);
    sync.diagnosticTarget = null;
    return true;
  }
  const next = target ?? captureDesignerTarget(view);
  if (!next) return true;
  const items = state === 'conflict' || state === 'missing' ? [] : warnings(sync);
  if (statusCodes[state]) items.push({ code: statusCodes[state], message, severity: 'error' });
  if (view.diagnostics.publish(next, items)) sync.diagnosticTarget = next;
  return true;
}
