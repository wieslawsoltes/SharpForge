/** Mount remains synchronous; this observed promise owns recovery, fallback and startup ordering. */
export function startStudioWorkspace(context, shell) {
  const state = context.state;
  const initial = {epoch: state.workspaceEpoch, revision: state.revision, disk: state.disk, nativeMode: state.nativeMode};
  const report = error => {
    if (!context.services.documents.disposed) context.toast(error.message, 'error');
    return {error, recovered: false};
  };
  const finish = recovered => {
    if (context.services.documents.disposed) return {cancelled: true};
    if (!recovered && (state.workspaceEpoch !== initial.epoch || state.revision !== initial.revision
        || state.disk !== initial.disk || state.nativeMode !== initial.nativeMode)) return {cancelled: true};
    let preparation;
    if (recovered) {
      context.renderWorkspace();
      const lazy = state.disk?.records?.some(record => record.lazy) ?? false;
      if (!state.recoveryReadOnly && !lazy && context.projects.sourceUris(context.projects.selectedId).length) {
        preparation = context.build(true);
      }
    } else preparation = context.loadSample('particles', true);
    return Promise.resolve(preparation).then(() => {
      if (context.services.documents.disposed) return {cancelled: true};
      return shell.startup({recovered: Boolean(recovered)});
    });
  };
  try {
    const recovered = context.recover();
    const result = recovered && typeof recovered.then === 'function' ? recovered.then(finish) : finish(recovered);
    return Promise.resolve(result).catch(report);
  } catch (error) {
    return Promise.resolve(report(error));
  }
}
