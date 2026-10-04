/** Keep source-control status in one shell contribution without rebuilding the editor. */
export function formatGitStatus({ branch, changes = [], aheadBehind } = {}) {
  const branchText = branch ?? 'Git';
  const counts = changes.length ? ` · ${changes.length}` : '';
  const remote = aheadBehind ? ` · ↑${aheadBehind.ahead} ↓${aheadBehind.behind}` : '';
  return `⑂ ${branchText}${counts}${remote}`;
}

export function updateGitStatus(indicator, state, message) {
  indicator.textContent = message ?? formatGitStatus(state);
  indicator.title = message ?? (state.repositoryId
    ? `${state.branch ?? state.repositoryId}: ${state.changes.length} changed files; open Git Changes to sync`
    : 'Open Git Changes');
  indicator.setAttribute('aria-label', indicator.title);
}
