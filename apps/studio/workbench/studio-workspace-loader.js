import { ProjectSystem, DiskWorkspace, importWorkspaceRecords, validateWorkspaceSettings, workspaceCandidates } from '@sharpforge/project-system';
import { validateFilePlan } from '@sharpforge/templates';
import { rebaseEditorSource } from '@sharpforge/editor';
import { studioDiskLimits, validateStudioWorkspaceRecords, isStudioTextRecord } from './workspace-limits.js';
import { studioSourceRecord, releaseStudioSources } from './studio-source-records.js';

function extractedWorkspace(records, options, prepared) {
  const folders = options.folders ?? records.folders ?? options.disk?.folders ?? [];
  const extracted = importWorkspaceRecords(records, folders, { rebaseSource: rebaseEditorSource });
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

/** Validate a complete workspace and source metadata before replacing any live document, project or launch setting. */
export async function prepareStudioWorkspace(input, { sessionRecovery, readSource } = {}) {
  const { folders = [], configuration = 'Debug' } = input;
  let records = input.records;
  const entry = input.entry ?? (input.mode === 'folder' ? null : workspaceCandidates(records)[0] ?? null);
  const mode = input.mode ?? (entry ? /\.(slnx|sln)$/i.test(entry) ? 'solution' : 'project' : 'folder');
  validateFilePlan({ records, folders }, []);
  for (const record of records) {
    if (!isStudioTextRecord(record) && !(record.bytes instanceof Uint8Array)) {
      throw new TypeError('Every workspace file must provide text or binary bytes; no workspace was changed.');
    }
  }
  const { byteLengths } = await validateStudioWorkspaceRecords(records, { signal: input.signal });
  records = records.map(record => Object.defineProperty(studioSourceRecord(record), 'byteLength', {
    value: byteLengths.get(record), enumerable: true, writable: true, configurable: true
  }));
  const system = entry ? new ProjectSystem(records, { configuration, maxFiles: studioDiskLimits.maxFiles }) : null;
  const snapshot = system?.load(entry) ?? null;
  if (snapshot && !snapshot.projects.length && snapshot.diagnostics.some(item => item.severity === 'error')) {
    throw new Error(snapshot.diagnostics.map(item => item.message).join('\n'));
  }
  const sources = records.filter(record => /\.cs$/i.test(record.path ?? record.uri) && isStudioTextRecord(record))
    .map((record, index) => studioSourceRecord(record, { version: record.model?.version ?? record.version ?? Date.now() + index }));
  const checked = input.settings ? validateWorkspaceSettings(input.settings, records.map(record => record.path)) : {};
  const projects = system ? [...system.projects.values()] : [{ id: '$workspace', outputType: 'exe' }];
  const recovery = input.preserveDocumentState ? null : sessionRecovery?.prepare(checked, { projects });
  const disk = input.disk ?? new DiskWorkspace(records, undefined, input.name ?? 'Workspace', folders, [], {
    ...studioDiskLimits, readSource
  });
  const startup = system ? input.startup && system.projects.has(input.startup) ? input.startup
    : snapshot.projects.find(project => ['exe', 'winexe'].includes(project.outputType.toLowerCase()))?.path
      ?? snapshot.projects[0]?.path ?? null : null;
  const available = new Set(sources.map(record => record.uri));
  const candidates = [checked.active, ...(system?.projects.get(startup)?.compile ?? []).map(file => file.path), sources[0]?.uri];
  const active = candidates.find(uri => available.has(uri)) ?? '';
  const tabs = checked.tabs?.filter(uri => available.has(uri)) ?? (active ? [active] : []);
  return { ...input, records, folders, configuration, entry, mode, system, snapshot, sources, checked, recovery, disk, startup, active, tabs };
}

function installWorkspace(state, staged, nativeBuild) {
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
    extensionConfig: staged.extensionConfig ?? staged.checked.extensions ?? null
  });
  if (!staged.preserveDocumentState) state.workspaceEpoch = (state.workspaceEpoch ?? 0) + 1;
  state.revision++;
  state.diskRevision++;
  nativeBuild.attached = false;
}

async function finishWorkspace(context, staged) {
  const { state, sessionRecovery, runtimeBridge, recentWorkspaces } = context;
  if (!staged.preserveDocumentState) context.resetEditors();
  context.renderWorkspace();
  if (staged.recovery) sessionRecovery.apply(staged.recovery);
  if (!staged.preserveDocumentState) runtimeBridge.select(null);
  if (staged.updateOnly) {
    context.saveLocal();
    context.scheduleAnalysis?.();
    return { committed: true, snapshot: staged.snapshot };
  }
  recentWorkspaces?.remember(context.currentWorkspaceMetadata());
  context.renderPanel('project');
  context.saveLocal();
  context.log(`Opened ${state.name}: ${staged.snapshot?.projects.length ?? 0} project(s), `
    + `${staged.records.length} files, ${staged.folders.length} folders. Loading does not execute MSBuild tasks or restore packages.`);
  const skipped = staged.disk?.skipped ?? staged.records.skipped ?? [];
  if (skipped.length) context.log('Excluded administrative/generated directories: ' + skipped.join(', '));
  const diagnostics = context.projectErrors();
  if (diagnostics.length) {
    context.applyAnalysis({ success: false, diagnostics, symbols: [], metrics: { errors: diagnostics.length, files: staged.sources.length } });
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
  let failure, load;
  try {
    load = options.load ?? context.workspaceLoads.begin({ state: context.state, documents: context.documents, signal: options.signal });
    load.check();
    let input = extractedWorkspace(records, {
      configuration: context.state.configuration, ...options, signal: load.signal
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
    load.check();
    if (!staged.preserveDocumentState) await context.stopQuietly();
    load.check();
    if (!staged.preserveDocumentState) context.savePrevious();
    let committedFailure;
    try {
      staged.validate?.();
      load.check();
      context.documents.replace(staged.sources, {
        discard: true, preserveEditors: true, preserveDirty: staged.preserveDocumentState === true,
        documentStates: staged.documentStates ?? null, tabs: staged.tabs, active: staged.active, signal: staged.signal,
        commitMetadata: () => installWorkspace(context.state, staged, context.nativeBuild)
      });
    } catch (error) {
      if (!error.committed) throw error;
      committedFailure = error;
    }
    const result = await finishWorkspace(context, staged);
    if (committedFailure) throw committedFailure;
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!options.load) load?.finish();
    try { releaseStudioSources(prepared, context.documents); }
    catch (error) {
      if (failure) throw new AggregateError([failure, error], 'Workspace loading failed and source cleanup reported errors');
      throw error;
    }
  }
}
