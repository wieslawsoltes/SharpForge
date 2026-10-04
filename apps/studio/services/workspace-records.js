import { ProjectSystem, DiskWorkspace, workspaceCandidates } from '@sharpforge/project-system';
import { validateFilePlan } from '@sharpforge/templates';
import { captureStudioDocuments, publishStudioDocumentChanges } from './documents.js';

/** Invoke adoption synchronously after the final check; an extra caller await would reopen a stale-workspace race. */
export async function commitStudioWorkspaceAfterStop(stop, { signal, validate }, commit) {
  signal?.throwIfAborted();
  validate?.();
  await stop();
  signal?.throwIfAborted();
  validate?.();
  return commit();
}

export function mapWorkspacePath(path, mappings) {
  const mapping = mappings.find(item => path === item.from || path.startsWith(item.from + '/'));
  return mapping ? mapping.to + path.slice(mapping.from.length) : path;
}

function workspaceModel(state, records, { entry: requestedEntry, restore }) {
  const entry = requestedEntry !== undefined ? requestedEntry : restore?.entry
    ?? records.find(record => record.path === state.projectSystem?.solution?.path)?.path
    ?? (state.workspaceMode === 'folder' ? null : workspaceCandidates(records)[0]);
  let system = null;
  let snapshot = null;
  let startup = restore?.startup ?? state.startupProject;
  if (entry) {
    system = new ProjectSystem(records, { configuration: state.configuration, maxFiles: 20000 });
    snapshot = system.load(entry);
    if (!system.projects.has(startup)) {
      startup = snapshot.projects.find(project => project.outputType.toLowerCase() === 'exe')?.path ?? snapshot.projects[0]?.path;
    }
  }
  return { entry, system, snapshot, startup };
}

function remapWorkspaceState(state, mappings, valid, restore) {
  if (restore) {
    state.active = restore.active;
    state.tabs = restore.tabs.filter(uri => valid.has(uri));
    state.breakpoints = restore.breakpoints;
  } else {
    state.active = mapWorkspacePath(state.active ?? '', mappings);
    state.tabs = state.tabs.map(uri => mapWorkspacePath(uri, mappings)).filter(uri => valid.has(uri));
    state.breakpoints = Object.fromEntries(Object.entries(state.breakpoints)
      .map(([uri, points]) => [mapWorkspacePath(uri, mappings), points]).filter(([uri]) => valid.has(uri)));
  }
  if (!valid.has(state.active)) state.active = state.files[0]?.uri ?? '';
}

function refreshEditorModels(state, editors) {
  state.applyingEdits = true;
  try {
    for (const file of state.files) {
      const editor = editors.get(file.uri);
      if (editor && editor.value !== file.text) editor.setValue(file.text);
    }
  } finally { state.applyingEdits = false; }
}

/** Validate and adopt one browser workspace transaction, then notify subscribers of its complete source state. */
export async function commitStudioWorkspaceRecords(host, {
  records, folders = [], mappings = [], restore = null, entry, signal, validate, onCommitted
}) {
  const { state, editors } = host;
  if (state.readOnly) throw new Error('Stop debugging before applying file changes');
  validateFilePlan({ records, folders }, []);
  const model = workspaceModel(state, records, { entry, restore });
  const oldFiles = new Map(state.files.map(file => [mapWorkspacePath(file.uri, mappings), file]));
  const files = records.filter(record => /\.cs$/i.test(record.path) && typeof record.text === 'string').map(record => ({
    ...oldFiles.get(record.path), uri: record.path, text: record.text, version: (oldFiles.get(record.path)?.version ?? Date.now()) + 1
  }));
  if (files.length > 100 || files.some(file => file.text.length > 2000000)) {
    throw new Error('Workspace source count/size limit exceeded; no changes applied');
  }
  const previous = captureStudioDocuments(state.files);
  const valid = new Set(files.map(file => file.uri));
  signal?.throwIfAborted();
  validate?.();
  for (const uri of [...editors.keys()]) {
    if (mapWorkspacePath(uri, mappings) === uri && valid.has(uri)) continue;
    editors.get(uri)?.dispose();
    editors.delete(uri);
  }
  state.files = files;
  state.extraFiles = records.filter(record => !/\.cs$/i.test(record.path) || typeof record.text !== 'string');
  state.folders = folders;
  state.projectSystem = model.system;
  state.projectSnapshot = model.snapshot;
  state.startupProject = model.startup;
  state.membershipDirty = true;
  if (model.entry) state.workspaceMode = /\.(slnx|sln)$/i.test(model.entry) ? 'solution' : 'project';
  state.disk ??= new DiskWorkspace(records);
  state.disk.records = records;
  remapWorkspaceState(state, mappings, valid, restore);
  state.revision++;
  state.diskRevision++;
  state.buildDirty = true;
  state.image = null;
  state.assembly = null;
  state.pdb = null;
  state.ilDump = null;
  state.importedAssembly = false;
  refreshEditorModels(state, editors);
  for (const file of state.files) state.dirtyFiles.add(file.uri);
  onCommitted?.();
  host.renderWorkspace();
  host.saveLocal();
  host.scheduleAnalysis();
  publishStudioDocumentChanges(host.documentEvents, previous, state.files);
}

/** Preserve dirty native buffers while refreshing file membership and publish the final replacement state. */
export async function refreshNativeStudioExplorer(host, mappings = [], partial = false) {
  const { state, editors, nativeBuild } = host;
  const paths = state.files.map(file => ({ old: file.uri, path: mapWorkspacePath(file.uri, mappings), file }));
  const workspace = await nativeBuild.refresh();
  const available = new Set(workspace.files.map(file => file.path));
  const next = [];
  for (const item of paths) {
    if (!available.has(item.path)) continue;
    const disk = await nativeBuild.client.read(item.path);
    if (!partial && item.file.text !== item.file.nativeBaseline && item.old === item.path) next.push(item.file);
    else next.push({ ...item.file, uri: item.path, text: disk.text, nativeHash: disk.hash,
      nativeBaseline: disk.text, version: item.file.version + 1 });
  }
  const previous = captureStudioDocuments(state.files);
  const valid = new Set(next.map(file => file.uri));
  for (const [uri, editor] of editors) if (!valid.has(uri)) { editor.dispose(); editors.delete(uri); }
  state.files = next;
  state.active = mapWorkspacePath(state.active ?? '', mappings);
  state.tabs = state.tabs.map(uri => mapWorkspacePath(uri, mappings)).filter(uri => valid.has(uri));
  state.breakpoints = Object.fromEntries(Object.entries(state.breakpoints)
    .map(([uri, points]) => [mapWorkspacePath(uri, mappings), points]).filter(([uri]) => available.has(uri)));
  nativeBuild.buffers.clear();
  nativeBuild.sourcePath = null;
  nativeBuild.renderSource(true);
  state.revision++;
  state.dirtyFiles.clear();
  refreshEditorModels(state, editors);
  host.renderWorkspace();
  publishStudioDocumentChanges(host.documentEvents, previous, state.files);
}
