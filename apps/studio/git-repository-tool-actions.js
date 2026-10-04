import { GitError, checkCancelled } from '@sharpforge/git';

export function formatRepositoryBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

function linkedSignal(signals) {
  const controller = new AbortController();
  const active = [...new Set(signals.filter(Boolean))];
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return { signal: controller.signal, dispose() {
    for (const signal of active) signal.removeEventListener('abort', abort);
  } };
}

function assertSavedNativeEditors(workbench) {
  const state = workbench.host.getState?.();
  if (!state?.nativeMode) return;
  const unsaved = workbench.host.hasUnsavedNativeChanges?.() ?? (state.dirtyFiles?.size || state.membershipDirty);
  if (unsaved) {
    throw new GitError('Conflict', 'Save native editor buffers before updating repository files.');
  }
}

/** Run through the workbench queue and retain only the caller's compact result, including adoption failures. */
export function runRepositoryTool(workbench, { title, action, describe, adopt = false, requireClean = false, signal } = {}) {
  const repositoryId = workbench.repositoryId;
  if (!repositoryId) return Promise.reject(new GitError('NotFound', 'Open a repository first.'));
  checkCancelled(signal);
  return workbench.run(async options => {
    const linked = linkedSignal([options.signal, signal]);
    const context = { ...options, signal: linked.signal };
    let saved;
    try {
      checkCancelled(context.signal);
      if (workbench.repositoryId !== repositoryId) throw new GitError('Conflict', 'The selected repository changed.');
      if (adopt || requireClean) assertSavedNativeEditors(workbench);
      await workbench.synchronize(context);
      if (requireClean) {
        const changes = await workbench.request('status', {}, context);
        if (changes.some(change => change.kind !== 'ignored')) {
          throw new GitError('Conflict', 'Commit, stash, or move changed files before this operation.');
        }
      }
      const result = await action(context);
      checkCancelled(context.signal);
      const display = describe?.(result) ?? { summary: 'Completed.' };
      saved = workbench.repositoryToolsResult = { repositoryId, title, ok: display.ok !== false,
        summary: display.summary, details: display.details, needsAdoption: adopt };
      if (adopt) {
        await workbench.adoptRepository(context);
        saved.needsAdoption = false;
      }
      return result;
    } catch (error) {
      if (!saved?.needsAdoption) {
        workbench.repositoryToolsResult = { repositoryId, title, ok: false,
          summary: error.message, details: { code: error.code ?? 'Error' } };
      }
      throw error;
    } finally { linked.dispose(); }
  }, { workspace: adopt });
}

const maintenance = Object.freeze({
  storageUsage: { title: 'Storage usage', params: {}, describe: result => ({
    summary: `${formatRepositoryBytes(result.totalBytes)} in ${result.objects} objects.`, details: result
  }) },
  fsck: { title: 'Repository integrity', params: { full: true, verifyPacks: true }, describe: result => ({
    ok: result.ok, summary: `${result.errors} errors, ${result.warnings} warnings; ${result.objects} objects checked.`,
    details: result
  }) },
  repack: { title: 'Repack', params: { prune: false, includeReflogs: true }, describe: maintenanceResult },
  gc: { title: 'Garbage collection', params: { prune: true, includeReflogs: true, graceSeconds: 14 * 86400 },
    describe: maintenanceResult }
});

function maintenanceResult(result) {
  return { summary: `${result.packed} objects packed; ${result.pruned.length} unreachable objects removed.`,
    details: { pack: result.pack, reachable: result.reachable, pruned: result.pruned.length, before: result.before, after: result.after } };
}

export function runRepositoryMaintenance(workbench, operation, { signal, confirm = globalThis.confirm } = {}) {
  const definition = maintenance[operation];
  if (!definition) throw new GitError('Unsupported', 'Unknown repository maintenance operation.');
  if (operation === 'gc' && !confirm('Remove unreachable objects that have passed the 14-day grace period? ' +
    'References, the index, and reflogs retain their reachable objects.')) return Promise.resolve(null);
  return runRepositoryTool(workbench, { ...definition, signal,
    action: options => workbench.request(operation, definition.params, options) });
}

export function configureRepositorySparse(workbench, { directories = '', disable = false, signal } = {}) {
  if (typeof directories !== 'string' || directories.length > 65536) throw new GitError('Limit', 'Sparse directory input is too large.');
  const paths = [...new Set(directories.split(/\r?\n/u).map(path => path.trim()).filter(Boolean))];
  if (paths.length > 1000) throw new GitError('Limit', 'Choose at most 1,000 sparse directories.');
  return runRepositoryTool(workbench, { title: disable ? 'Disable sparse checkout' : 'Sparse checkout', signal,
    adopt: true, requireClean: true,
    action: options => workbench.request('configureSparseCheckout', disable ? { disable: true } : { directories: paths }, options),
    describe: result => ({ summary: `${result.written.length} files materialized; ${result.removed.length} files removed from the worktree.`,
      details: { enabled: result.enabled, directories: result.directories, written: result.written.length, removed: result.removed.length } })
  });
}
