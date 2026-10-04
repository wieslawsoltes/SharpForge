import {
  ProviderDiskWorkspace as DiskWorkspace, importWorkspaceRecords,
  validateWorkspaceSettings, decodeWorkspaceFile, readProviderDirectory as readDirectory
} from '@sharpforge/project-system';
import {hydrateWorkspaceRecords} from './workspace-hydration.js';
import {prepareWorkspaceRecords, sourceBuffers, mapWorkspacePath} from './workspace-records.js';
import {createWorkspaceSave} from './workspace-save.js';
import {createWorkspaceEditorLifecycle} from './workspace-editor-lifecycle.js';

function retireBuild(state) {
  state.revision++;
  state.diskRevision++;
  state.buildDirty = true;
  for (const key of ['image', 'assembly', 'pdb', 'result', 'ilDump']) state[key] = null;
  state.importedAssembly = false;
}

function extraRecords(records) {
  return records.filter(record => !/\.cs$/i.test(record.path) || typeof record.text !== 'string');
}

function sameBytes(left, right) {
  return left === right || left instanceof Uint8Array && right instanceof Uint8Array &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

function folderRecords(state) {
  const records = new Map(state.extraFiles.map(record => [record.path, record]));
  for (const file of state.files) records.set(file.uri, {...state.disk?.record(file.uri), path: file.uri, text: file.text});
  const ordered = [];
  for (const original of state.disk?.records ?? []) {
    const record = records.get(original.path);
    if (record) { ordered.push(record); records.delete(original.path); }
  }
  return [...ordered, ...records.values()];
}

/** Workspace replacement, editor remapping and disk I/O share one application state transition boundary. */
export function createWorkspaceSession(host) {
  const {state} = host;
  const documents = createWorkspaceEditorLifecycle(host);
  let loadEpoch = 0;

  async function load(input, options = {}) {
    if (state.readOnly && !state.recoveryReadOnly) throw new Error('Stop execution before replacing a workspace');
    const epoch = ++loadEpoch, revision = state.revision;
    let {entry = null, startup = null, disk = null, extensionConfig = null, configuration = state.configuration,
      folders = input.folders ?? disk?.folders ?? [], mode = null, name = null, settings = null,
      select = false, readOnly = false, persist = true, dirty = [], recoveryMetadata = null, signal} = options;
    const extracted = readOnly ? {manifest: false} : importWorkspaceRecords(input, folders);
    let records = input;
    if (extracted.manifest) {
      records = extracted.records;
      folders = extracted.folders;
      settings ??= extracted.settings;
      entry ??= settings.entry;
      mode ??= settings.mode;
      startup ??= settings.startup;
      name ??= settings.name;
      configuration = settings.configuration ?? configuration;
      extensionConfig ??= settings.extensions;
    }
    if (state.nativeMode && host.hasNativeChanges() &&
        !host.confirm('Leave the native workspace with unsaved source or project XML changes?')) return null;
    const chosen = select ? await host.selectImport(records, {name: name ?? disk?.name ?? 'Workspace',
      folders, settings: settings ?? {}}) : null;
    if (select && !chosen) return null;
    if (chosen) { entry = chosen.entry; mode = chosen.mode; }
    const checked = settings ? validateWorkspaceSettings(settings, records.map(record => record.path)) : null;
    entry ??= checked?.entry;
    startup ??= checked?.startup;
    mode ??= checked?.mode;
    name ??= checked?.name;
    if (options.configuration === undefined) configuration = checked?.configuration ?? configuration;
    const next = await prepareWorkspaceRecords(records, {entry, startup, disk, configuration, folders, mode,
      active: checked?.active, tabs: checked?.tabs, readOnly, signal});
    if (epoch !== loadEpoch || revision !== state.revision) throw new Error('Workspace changed while opening files; retry');
    host.revokeRuntime();
    await host.stop();
    signal?.throwIfAborted();
    if (epoch !== loadEpoch || revision !== state.revision) throw new Error('Workspace changed while stopping execution; retry');
    documents.dispose();
    if (persist) host.savePrevious();
    state.nativeMode = false;
    host.nativeBuild.attached = false;
    state.langVersion = checked?.langVersion ?? '14';
    state.extraFiles = extraRecords(next.records);
    state.folders = [...folders];
    state.workspaceMode = next.mode;
    state.workspaceEpoch = (state.workspaceEpoch ?? 0) + 1;
    state.configuration = configuration;
    state.membershipDirty = false;
    state.disk = disk ?? new DiskWorkspace(next.records, undefined, name ?? 'Workspace', folders,
      input.skipped ?? [], {report: input.importReport ?? null});
    state.projectSystem = next.system;
    state.projectSnapshot = next.snapshot;
    state.startupProject = next.startup;
    state.name = name ?? next.snapshot?.solution.name ?? disk?.name ?? 'Workspace';
    state.files = next.files;
    state.active = next.active;
    state.tabs = next.tabs;
    state.breakpoints = checked?.breakpoints ?? {};
    state.functionBreakpoints = checked?.functionBreakpoints ?? [];
    const paths = new Set(next.records.map(record => record.path));
    state.dirtyFiles = new Set(dirty.filter(path => paths.has(path)));
    state.extensionConfig = extensionConfig ?? checked?.extensions ?? null;
    state.recoveryReadOnly = readOnly;
    state.recoveryEntry = readOnly ? next.entry : null;
    state.recoveryMetadata = recoveryMetadata;
    state.readOnly = readOnly;
    retireBuild(state);
    host.resetEditors();
    host.renderWorkspace();
    host.renderProject();
    if (persist) host.saveLocal();
    host.log(`Opened ${state.name}: ${next.snapshot?.projects.length ?? 0} project(s), ` +
      `${next.records.length} files, ${folders.length} folders.`);
    const errors = host.projectErrors();
    if (errors.length) host.applyAnalysis({success: false, diagnostics: errors, symbols: [],
      metrics: {errors: errors.length, files: next.files.length}});
    if (!errors.length && !readOnly && !next.records.some(record => record.lazy) && next.files.length) await host.build(true);
    else host.ready(readOnly ? 'Recovered read-only — grant folder access before loading or building files'
      : next.records.some(record => record.lazy) ? 'Ready — sources load when opened or built' : 'Ready');
    return next.snapshot ?? {solution: {name: state.name, path: null, projectPaths: []}, projects: [], diagnostics: [], mode: 'folder'};
  }

  async function commit({records, folders = [], mappings = [], restore = null, entry, dirty, diskSnapshot,
    diskCommitted = false, persistedPaths = [], preserveMembership = false}) {
    if (state.readOnly) throw new Error('Stop debugging before applying file changes');
    const old = host.context();
    const next = await prepareWorkspaceRecords(records, {folders, disk: diskSnapshot ?? state.disk, configuration: state.configuration,
      entry: entry !== undefined ? entry : restore?.entry ?? old.entry, startup: restore?.startup ?? state.startupProject,
      mode: state.workspaceMode, active: restore?.active ?? mapWorkspacePath(state.active, mappings),
      tabs: restore?.tabs ?? state.tabs.map(path => mapWorkspacePath(path, mappings))});
    if (old.identity !== host.context().identity || old.revision !== state.revision) {
      throw new Error('Workspace changed while preparing the file operation');
    }
    const previous = new Map(state.files.map(file => [mapWorkspacePath(file.uri, mappings), file]));
    const files = sourceBuffers(next.records, previous);
    const valid = new Set(files.map(file => file.uri));
    for (const [uri, editor] of host.editors) {
      if (mapWorkspacePath(uri, mappings) !== uri || !valid.has(uri)) { editor.dispose(); host.editors.delete(uri); }
    }
    state.files = files;
    state.extraFiles = extraRecords(next.records);
    state.folders = [...folders];
    state.projectSystem = next.system;
    state.projectSnapshot = next.snapshot;
    state.startupProject = next.startup;
    state.workspaceMode = next.mode;
    state.disk ??= new DiskWorkspace(next.records);
    state.active = next.active;
    state.tabs = next.tabs;
    const paths = new Set(next.records.map(record => record.path));
    state.breakpoints = Object.fromEntries(Object.entries(restore?.breakpoints ?? state.breakpoints)
      .map(([path, points]) => [restore ? path : mapWorkspacePath(path, mappings), points]).filter(([path]) => paths.has(path)));
    const nextDirty = new Set(dirty ?? restore?.dirty ?? [...state.dirtyFiles].map(path => mapWorkspacePath(path, mappings)));
    if (diskCommitted && dirty === undefined) for (const path of persistedPaths) nextDirty.delete(path);
    if (!diskCommitted && dirty === undefined) {
      const before = new Map(old.records.map(record => [mapWorkspacePath(record.path, mappings), record]));
      for (const record of next.records) {
        const prior = before.get(record.path);
        if (!prior || prior.text !== record.text || !sameBytes(prior.bytes, record.bytes) && record.text === undefined) {
          nextDirty.add(record.path);
        }
      }
    }
    state.dirtyFiles = new Set([...nextDirty].filter(path => paths.has(path)));
    if (!preserveMembership) state.membershipDirty = !diskCommitted;
    retireBuild(state);
    state.applyingEdits = true;
    try {
      for (const file of files) {
        const editor = host.editors.get(file.uri);
        if (editor && editor.value !== file.text) editor.setValue(file.text);
      }
    } finally { state.applyingEdits = false; }
    host.renderWorkspace();
    host.saveLocal();
    host.scheduleAnalysis();
  }

  const save = createWorkspaceSave(host, commit);

  async function snapshot() {
    const context = host.context();
    if (!context.native) {
      const records = await hydrateWorkspaceRecords(context);
      if (host.context().identity !== context.identity || state.revision !== context.revision) {
        throw new Error('Workspace changed during export; retry');
      }
      return {records, folders: context.folders, settings: host.settings()};
    }
    if (host.nativeBuild.busy) throw new Error('Finish or cancel the native build before exporting');
    const records = [];
    let bytesRead = 0;
    for (const record of context.records) {
      const bytes = await context.client.binary(record.path);
      if ((bytesRead += bytes.length) > 128 * 1024 * 1024) throw new Error('Workspace exceeds the 128 MiB ZIP budget');
      const decoded = decodeWorkspaceFile(record.path, bytes);
      if (typeof record.text === 'string') decoded.text = record.text;
      records.push(decoded);
    }
    if (host.context().identity !== context.identity || state.revision !== context.revision) {
      throw new Error('Workspace changed during export; retry');
    }
    return {records, folders: context.folders, settings: {...host.settings(), mode: context.solutionPath ? 'solution' : 'folder',
      entry: context.solutionPath ?? undefined,
      startup: context.startup && records.some(record => record.path === context.startup) ? context.startup : undefined}};
  }

  async function reopenRecent(recent) {
    if (recent.handle && recent.permission === 'granted' && !recent.readOnly) {
      const disk = await readDirectory(recent.handle, {openedPaths: recent.openDocuments?.map(document => document.path)});
      return load(disk.records, {disk, folders: disk.folders, settings: {...recent.record?.settings,
        tabs: recent.openDocuments?.map(document => document.path ?? document) ?? recent.record?.openDocuments?.map(document => document.path)},
        entry: recent.record?.settings?.entry, startup: recent.record?.settings?.startup});
    }
    if (!recent.record) throw new Error('Grant folder access before reopening this workspace');
    return load(recent.record.records, {folders: recent.record.folders, settings: {...recent.record.settings,
      tabs: recent.record.openDocuments?.map(document => document.path)}, readOnly: true, name: recent.record.name,
      dirty: recent.record.dirty ?? [], persist: false, recoveryMetadata: {settings: recent.record.settings,
        appDescriptors: recent.record.appDescriptors, explorer: recent.record.explorer, recentTemplates: recent.record.recentTemplates}});
  }

  return {load, commit, save, snapshot, reopenRecent, ...documents};
}

/** Produce a versioned snapshot in linear time even when the directory contains many unloaded files. */
export function workspaceContext(state, {nativeBuild, explorerActions, settings}) {
  const sources = new Map(state.files.map(file => [file.uri, file]));
  const raw = state.nativeMode ? state.nativeWorkspace?.files ?? [] : state.projectSystem
    ? [...state.projectSystem.files.values()] : folderRecords(state);
  const records = raw.map(file => {
    const path = file.path ?? file.uri;
    const buffer = sources.get(path) ?? (state.nativeMode ? nativeBuild.buffers.get(path) : null);
    const record = {...file, path, ...(buffer ? {text: buffer.text, version: buffer.version ?? file.version ?? 1} : {})};
    if (buffer?.readOnly !== undefined) record.readOnly = buffer.readOnly;
    if (buffer?.generated !== undefined) record.generated = buffer.generated;
    return record;
  });
  const snapshot = state.nativeMode ? state.nativeWorkspace?.hierarchy : state.projectSnapshot;
  const identity = (state.nativeMode ? 'native:' : 'preview:') + (state.nativeMode && state.nativeWorkspace?.root
    ? state.nativeWorkspace.root : (state.projectSystem?.solution?.path ?? state.name) + ':' + (state.workspaceEpoch ?? 0));
  return {identity, revision: state.revision, coordinationIdentity: state.coordinationIdentity,
    mode: state.workspaceMode ?? 'solution', name: state.name, native: state.nativeMode,
    root: state.nativeMode ? state.nativeWorkspace?.root : null, client: nativeBuild.client,
    platform: nativeBuild.capabilities?.toolchains?.platform,
    nativeAvailable: nativeBuild.capabilities?.available, trusted: nativeBuild.settings.trusted && nativeBuild.capabilities?.trusted,
    buildBusy: nativeBuild.busy, fileBusy: !!(state.saveBusy || explorerActions.busy || explorerActions.runningMutation), readOnly: state.readOnly,
    records, files: records, snapshot, startup: state.nativeMode ? state.nativeStartup ?? nativeBuild.settings.project : state.startupProject,
    solutionPath: /\.(slnx|sln)$/i.test(snapshot?.solution?.path ?? '') ? snapshot.solution.path : null,
    entry: state.projectSystem?.solution?.path ?? state.recoveryEntry,
    folders: state.nativeMode ? state.nativeWorkspace?.folders ?? [] : state.folders,
    active: state.active, tabs: state.tabs, breakpoints: state.breakpoints,
    dirty: [...state.dirtyFiles, ...nativeBuild.sourceChanges().map(file => file.path)],
    generated: state.result?.generatedSources ?? [], symbols: state.nativeMode ? [] : state.result?.symbols ?? [],
    disk: state.nativeMode ? null : state.disk, provider: state.nativeMode ? null : state.disk?.provider,
    appDescriptors: state.recoveryMetadata?.appDescriptors, explorer: state.recoveryMetadata?.explorer,
    recentTemplates: state.recoveryMetadata?.recentTemplates, settings: {...state.recoveryMetadata?.settings, ...settings}};
}
