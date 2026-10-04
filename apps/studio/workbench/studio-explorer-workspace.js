import { workspaceCandidates } from '@sharpforge/project-system';
import { loadStudioWorkspace } from './studio-workspace-loader.js';
import { isStudioTextRecord } from './workspace-limits.js';

export function mapStudioWorkspacePath(path, mappings) {
  if (!path) return path;
  const mapping = mappings.find(item => path === item.from || path.startsWith(item.from + '/'));
  return mapping ? mapping.to + path.slice(mapping.from.length) : path;
}

/** Commit a prepared Explorer plan with source ownership, project metadata and history baselines in one host transaction. */
export function commitStudioExplorerWorkspace(payload, context) {
  const { records, folders = [], mappings = [], restore, documentStates, validate } = payload;
  const { state } = context;
  const revision = state.revision;
  const epoch = state.workspaceEpoch;
  const current = context.workspaceSettings();
  const mapped = path => mapStudioWorkspacePath(path, mappings);
  const available = new Set(records.filter(record => /\.cs$/i.test(record.path) && isStudioTextRecord(record)).map(record => record.path));
  const paths = new Set(records.map(record => record.path));
  const previousEntry = restore ? restore.entry : mapped(state.projectSystem?.solution?.path);
  const entry = payload.entry !== undefined ? payload.entry : previousEntry && paths.has(previousEntry) ? previousEntry
    : state.workspaceMode === 'folder' ? null : workspaceCandidates(records)[0] ?? null;
  const active = restore ? restore.active : mapped(state.active);
  const tabs = (restore?.tabs ?? state.tabs.map(mapped)).filter(uri => available.has(uri));
  const breakpoints = Object.fromEntries(Object.entries(restore?.breakpoints ?? state.breakpoints)
    .map(([uri, points]) => [restore ? uri : mapped(uri), points]).filter(([uri]) => available.has(uri)));
  const settings = { ...current, active: available.has(active) ? active : [...available][0] ?? '', tabs, breakpoints,
    entry: entry ?? undefined, startup: restore?.startup ?? mapped(state.startupProject) ?? undefined };
  return loadStudioWorkspace(records, {
    name: state.name, mode: entry ? /\.(slnx|sln)$/i.test(entry) ? 'solution' : 'project' : 'folder', entry,
    folders, settings, startup: settings.startup, configuration: state.configuration,
    disk: state.disk, documentStates, preserveDocumentState: true, membershipDirty: true, updateOnly: true,
    validate: () => {
      if (state.readOnly || state.nativeMode || state.revision !== revision || state.workspaceEpoch !== epoch) {
        throw new Error('Workspace changed while preparing the file operation; no changes were applied');
      }
      validate?.();
    }
  }, context);
}
