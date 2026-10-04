import { importWorkspaceRecords } from '@sharpforge/project-system';
import { rebaseEditorSource } from '@sharpforge/editor';
import { isStudioTextRecord } from './workspace-limits.js';
import { releaseStudioSources } from './studio-source-records.js';
import { prepareStudioWorkspace } from './studio-workspace-preparation.js';
export { prepareStudioWorkspace } from './studio-workspace-preparation.js';

function extractedWorkspace(records, options, prepared) {
  const folders = options.folders ?? records.folders ?? options.disk?.folders ?? [];
  const extracted = options.readOnly ? {records, folders} : importWorkspaceRecords(records, folders, { rebaseSource: rebaseEditorSource });
  prepared.push(...extracted.records);
  if (!extracted.manifest) return { ...options, records, folders };
  const settings = options.settings ?? extracted.settings;
  const previousDisk = options.disk;
  let disk = previousDisk;
  if (previousDisk && extracted.pathMap) {
    disk = previousDisk.rebasePaths(extracted.pathMap, extracted.records, extracted.folders);
  }
  return {
    ...options, disk, records: extracted.records, folders: extracted.folders, settings,
    entry: options.entry ?? settings.entry, mode: options.mode ?? settings.mode,
    startup: options.startup ?? settings.startup, name: options.name ?? settings.name,
    configuration: settings.configuration ?? options.configuration,
    extensionConfig: options.extensionConfig ?? settings.extensions
  };
}

function installWorkspace(state, staged, nativeBuild) {
  const readOnly = staged.readOnly ?? (staged.preserveDocumentState ? state.recoveryReadOnly : false);
  Object.assign(state, {
    langVersion: staged.checked.langVersion ?? '14', nativeMode: false,
    extraFiles: staged.records.filter(record => !/\.cs$/i.test(record.path) || !isStudioTextRecord(record)),
    folders: [...staged.folders], workspaceMode: staged.mode, configuration: staged.configuration,
    membershipDirty: staged.membershipDirty ?? (staged.preserveDocumentState ? state.membershipDirty : false),
    disk: staged.disk, projectSystem: staged.system, projectSnapshot: staged.snapshot, startupProject: staged.startup,
    name: staged.name ?? staged.snapshot?.solution.name ?? staged.disk?.name ?? 'Workspace',
    active: staged.active, tabs: staged.tabs, breakpoints: staged.checked.breakpoints ?? {},
    functionBreakpoints: staged.checked.functionBreakpoints ?? [],
    image: null, assembly: null, pdb: null, result: null, ilDump: null, importedAssembly: false, buildDirty: true,
    extensionConfig: staged.extensionConfig ?? staged.checked.extensions ?? null,
    recoveryReadOnly: readOnly, recoveryEntry: readOnly ? staged.entry : null,
    recoveryMetadata: staged.recoveryMetadata ?? (staged.preserveDocumentState ? state.recoveryMetadata : null), readOnly
  });
  if (staged.dirty !== undefined) {
    const paths = new Set(staged.records.map(record => record.path));
    state.dirtyFiles = new Set([...staged.dirty].filter(path => paths.has(path)));
  }
  if (!staged.preserveDocumentState) state.workspaceEpoch = (state.workspaceEpoch ?? 0) + 1;
  state.revision++;
  state.diskRevision++;
  if (nativeBuild) nativeBuild.attached = false;
}

async function finishWorkspace(context, staged) {
  const { state, sessionRecovery, runtimeBridge, recentWorkspaces } = context;
  if (!staged.preserveDocumentState) context.resetEditors();
  context.renderWorkspace();
  if (staged.recovery) sessionRecovery.apply(staged.recovery);
  if (!staged.preserveDocumentState) runtimeBridge?.select(null);
  if (staged.updateOnly) {
    if (staged.persist !== false) context.saveLocal();
    context.scheduleAnalysis?.();
    return { committed: true, snapshot: staged.snapshot };
  }
  if (staged.persist !== false) recentWorkspaces?.remember(context.currentWorkspaceMetadata());
  context.renderPanel('project');
  if (staged.persist !== false) context.saveLocal();
  context.log(`Opened ${state.name}: ${staged.snapshot?.projects.length ?? 0} project(s), `
    + `${staged.records.length} files, ${staged.folders.length} folders. Loading does not execute MSBuild tasks or restore packages.`);
  const skipped = staged.disk?.skipped ?? staged.records.skipped ?? [];
  if (skipped.length) context.log('Excluded administrative/generated directories: ' + skipped.join(', '));
  const diagnostics = context.projectErrors();
  if (diagnostics.length) {
    context.applyAnalysis({ success: false, diagnostics, symbols: [], metrics: { errors: diagnostics.length, files: staged.sources.length } });
  } else if (state.recoveryReadOnly || staged.records.some(record => record.lazy)) {
    context.status(state.recoveryReadOnly ? 'Recovered read-only — grant folder access before loading or building files'
      : 'Ready — sources load when opened or built');
    context.renderTree();
  } else if (context.projectServices.sourceUris(context.projectServices.selectedId).length) await context.build(true);
  else {
    context.status('Ready — empty ' + staged.mode);
    context.renderTree();
  }
  return staged.snapshot ?? { solution: { name: state.name, path: null, projectPaths: [] }, projects: [], diagnostics: [], mode: 'folder' };
}

/** Consume prepared import models: adoption commits ownership; cancellation/failure releases only models still outside the live workspace. */
export async function loadStudioWorkspace(records, options, context) {
  const prepared = [...records];
  let failure, load, committed = false;
  try {
    load = options.load ?? context.workspaceLoads.begin({ state: context.state, documents: context.documents, signal: options.signal });
    load.check();
    let input = extractedWorkspace(records, {
      configuration: context.state.configuration, ...options, signal: load.signal, check: load.check
    }, prepared);
    if (context.state.nativeMode && !context.confirmLeaveNative()) return null;
    if (input.select) {
      const selected = await context.projectWizard.selectImport(input.records, {
        name: input.name ?? input.disk?.name ?? 'Workspace', folders: input.folders, settings: input.settings ?? {}
      });
      load.check();
      if (!selected) return null;
      input = { ...input, entry: selected.entry, mode: selected.mode };
    }
    const staged = await prepareStudioWorkspace(input, context);
    prepared.push(...staged.sources);
    load.check();
    if (!staged.preserveDocumentState) await context.stopQuietly();
    load.check();
    if (!staged.preserveDocumentState && staged.persist !== false) context.savePrevious();
    let committedFailure;
    try {
      staged.validate?.();
      load.check();
      context.documents.replace(staged.sources, {
        discard: true, preserveEditors: true, preserveDirty: staged.preserveDocumentState === true,
        documentStates: staged.documentStates ?? null, tabs: staged.tabs, active: staged.active, signal: staged.signal,
        commitMetadata: () => installWorkspace(context.state, staged, context.nativeBuild)
      });
      committed = true;
    } catch (error) {
      if (!error.committed) throw error;
      committed = true;
      committedFailure = error;
    }
    const result = await finishWorkspace(context, staged);
    if (committedFailure) throw committedFailure;
    return result;
  } catch (error) {
    if (committed) error.committed = true;
    failure = error;
    throw error;
  } finally {
    if (!options.load) load?.finish();
    try { releaseStudioSources(prepared, context.documents); }
    catch (error) {
      if (failure) {
        const combined = new AggregateError([failure, error], 'Workspace loading failed and source cleanup reported errors');
        if (committed || failure.committed) combined.committed = true;
        throw combined;
      }
      if (committed) error.committed = true;
      throw error;
    }
  }
}
