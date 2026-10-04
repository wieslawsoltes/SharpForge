/** Project evaluation and lazy file loading at the application/worker boundary. */
import {getCaseInsensitive} from '@sharpforge/project-system';
import {nativeCompilationRequest} from './native-build/workspace-state.js';
import {assertProjectCurrent, selectedBuildProjects, contextFile, setHydratedBuildFile, beginProjectBuild,
  prepareBuildTargets, prepareBuildContext, attachProjectBuild, finalizeBuildTargets} from './project-targets.js';
import {rememberProjectArtifacts, cachedProjectArtifacts} from './project-artifacts.js';
import {folderCompilationFiles, hydrateFolderSources} from './folder-compilation.js';
import {runProjectBuild} from './project-build-runner.js';

const pathOf = file => file.path ?? file.uri;

function cancelled(signal) {
  if (signal?.aborted) throw new DOMException('Project preparation cancelled', 'AbortError');
}

function overlaySources(sources, files) {
  const buffers = new Map(files.map(file => [file.uri, file]));
  return sources.map(source => {
    const buffer = buffers.get(source.uri ?? source.path);
    return buffer ? {...source, uri: buffer.uri, text: buffer.text, version: buffer.version} : {...source};
  });
}

/** Read only compilation inputs; opening a large folder never creates thousands of editor buffers. */
export async function hydrateProjectSources(state, {signal, contexts} = {}) {
  cancelled(signal);
  if (!state.projectSystem || !state.startupProject) return hydrateFolderSources(state, {signal});
  if (!state.disk?.load) return;
  const {projectSystem: system, revision, disk, workspaceEpoch, startupProject, nativeMode} = state;
  const identity = {disk, workspaceEpoch, startupProject, nativeMode};
  for (const project of contexts ?? selectedBuildProjects(state)) {
    const paths = new Set([...project.compile.map(item => item.path),
      ...(project.references ?? []).map(reference => reference.hintPath ?? reference.path).filter(Boolean)]);
    for (const path of paths) {
      assertProjectCurrent(state, system, revision, signal, identity);
      const current = contextFile(system, path, project.contextId);
      if (!current?.lazy) continue;
      const record = await disk.load(path, {signal});
      assertProjectCurrent(state, system, revision, signal, identity);
      setHydratedBuildFile(system, path, record, project.contextId);
    }
  }
}

/** Inactive contexts remain visible in project diagnostics without blocking a selected-context build. */
export function projectBuildErrors(state) {
  const system = state.projectSystem;
  if (!system || !state.startupProject) return [];
  let projects;
  try { projects = selectedBuildProjects(state); }
  catch (error) {
    return [{path: state.startupProject, uri: state.startupProject, code: error.code ?? 'SFP1901', severity: 'error',
      start: 0, length: 1, message: error.message}];
  }
  const paths = new Set(projects.map(project => project.path));
  const contexts = new Set(projects.map(project => project.contextId));
  return (system.diagnostics ?? state.projectSnapshot?.diagnostics ?? []).filter(item => item.severity === 'error' &&
    (paths.has(item.project ?? item.path) || item.path === system.solution?.path) && (!item.contextId || contexts.has(item.contextId)))
    .map(item => ({...item, uri: item.file ?? item.path, start: item.start ?? 0, length: item.length ?? 1}));
}

/** Include SDK-generated documents and keep startup-project sources separate from dependency sources. */
export function projectCompilationFiles(state) {
  if (!state.projectSystem || !state.startupProject) return folderCompilationFiles(state);
  const system = state.projectSystem;
  const project = system.projects.get(state.startupProject);
  if (!project || project.unloaded) return [];
  const sources = project.compile.flatMap(item => {
    const record = contextFile(system, item.path, project.contextId);
    return typeof record?.text === 'string' ? [{...record, uri: item.path, version: record.version ?? 1}] : [];
  });
  sources.push(...(project.generatedSources ?? []).map(source => ({...source, uri: pathOf(source), version: 1})));
  return overlaySources(sources, state.files);
}

function unitReferences(unit, system) {
  return (unit.metadataReferences ?? []).map(reference => {
    const path = reference.hintPath ?? reference.path;
    const record = path ? contextFile(system, path, unit.contextId) : null;
    return {...reference, ...(record?.bytes ? {bytes: record.bytes} : {})};
  });
}

function applyBuffers(state) {
  for (const buffer of state.files) {
    const record = state.projectSystem.files.get(buffer.uri);
    if (record) state.projectSystem.files.set(buffer.uri, {...record, text: buffer.text, version: buffer.version});
  }
}

function compilationUnit(state, unit) {
  return {...unit, sources: overlaySources(unit.sources, state.files), metadataReferences: unitReferences(unit, state.projectSystem)};
}

async function prepareUnitRequest(state, project, session, artifacts, params) {
  const {signal, ...request} = params;
  applyBuffers(state);
  const prepared = await prepareBuildContext(state, session, project, signal);
  await hydrateProjectSources(state, {signal, contexts: [prepared]});
  const unit = compilationUnit(state, session.system.buildUnit(state.startupProject, prepared.contextId));
  const required = new Set(unit.references.map(reference => reference.contextId ?? reference.project));
  const dependencyArtifacts = artifacts.filter(artifact => required.has(artifact.contextId ?? artifact.project) && artifact.success)
    .map(artifact => ({project: artifact.project, contextId: artifact.contextId, assembly: artifact.assembly,
      success: true, runtimeProfile: 'sharpforge'}));
  return attachProjectBuild({...request, revision: state.revision, assemblyName: unit.assemblyName, extensions: state.extensionConfig,
    files: unit.sources.filter(source => !(source.generated && source.kind === 'assembly-info')),
    compilationOptions: unit.options, outputKind: unit.options.outputKind,
    buildPlan: {startup: unit.project, startupContextId: unit.contextId, units: [unit], dependencyArtifacts,
      diagnostics: unit.diagnostics, outputLayout: session.system.outputLayout(state.startupProject)}}, session);
}

/** Build a structured-clone-safe request after every required lazy source is materialized. */
export async function prepareProjectRequest(state, method, params = {}) {
  const {signal, ...request} = params;
  cancelled(signal);
  const native = nativeCompilationRequest(state);
  if (native) return {...request, ...native, revision: state.revision,
    extensions: {...state.extensionConfig, additionalFiles: native.additionalFiles}};
  const session = method === 'build' && state.projectSystem && state.startupProject ? beginProjectBuild(state) : null;
  await hydrateProjectSources(state, {signal});
  cancelled(signal);
  const system = state.projectSystem;
  if (!system || !state.startupProject) return {...request, files: folderCompilationFiles(state),
    revision: state.revision, assemblyName: state.name, extensions: state.extensionConfig,
    compilationOptions: {outputKind: 'exe', langVersion: state.langVersion}, outputKind: 'exe'};

  applyBuffers(state);

  if (session) {
    await prepareBuildTargets(state, session, signal);
    await hydrateProjectSources(state, {signal});
  }
  const plan = system.buildPlan(state.startupProject);
  const units = plan.units.map(unit => compilationUnit(state, unit));
  const startup = units.find(unit => (unit.contextId ?? unit.project) === (plan.startupContextId ?? plan.startup));
  if (!startup) throw new Error('The startup project has no compilation unit');
  const files = startup.sources.filter(source => !(source.generated && source.kind === 'assembly-info'));
  const priorArtifacts = method === 'build' ? new Map() : cachedProjectArtifacts(state, {...plan, units});
  const references = method === 'build' ? [] : (startup.references ?? []).flatMap(reference => {
    const artifact = priorArtifacts.get(reference.contextId ?? reference.project);
    return reference.referenceOutputAssembly !== false && artifact?.success && artifact.assembly ? [{bytes: artifact.assembly, runtimeProfile: 'sharpforge',
      display: reference.output, aliases: String(reference.aliases ?? 'global').split(/[;,]/).filter(Boolean)}] : [];
  });
  references.push(...startup.metadataReferences.filter(reference => reference.bytes).map(reference => ({bytes: reference.bytes,
    display: reference.hintPath ?? reference.name, aliases: String(getCaseInsensitive(reference.metadata, 'Aliases') ?? 'global')
      .split(/[;,]/).filter(Boolean)})));
  const prepared = {...request, files, revision: state.revision, assemblyName: startup.assemblyName,
    extensions: state.extensionConfig, compilationOptions: {...startup.options, references}, outputKind: startup.options.outputKind,
    ...(method === 'build' ? {buildPlan: {...plan, units}} : {})};
  return session ? attachProjectBuild(prepared, session) : prepared;
}

/** Finish only prepared successful contexts and retain their dependency metadata for later analysis requests. */
export async function finalizeProjectBuild(state, request, result, options = {}) {
  const finalized = await finalizeBuildTargets(state, request, result, options);
  if (request.buildPlan && state.projectSystem) rememberProjectArtifacts(state.projectSystem, request.buildPlan, finalized);
  return finalized;
}

/** Profiles supply the same explicit arguments and environment to the browser and native run requests. */
export function projectLaunchOptions(state, overrides = {}) {
  const system = state.projectSystem;
  if (!system || !state.startupProject) return {...overrides};
  const profile = system.runOptions(state.startupProject, {profile: state.launchProfile, ...overrides});
  if (profile.commandName !== 'Project') throw new Error('Executable launch profiles require the native MSBuild host');
  return {...profile, ...overrides, args: [...profile.args], environment: {...profile.environment}};
}

/** Disk search uses the streaming file index instead of requiring every source in the language worker. */
export async function requestProjectCompilation(state, compiler, method, params = {}) {
  if (method === 'findInFiles' && state.disk?.findInFiles) {
    return state.disk.findInFiles(params.query, {...params.options, signal: params.signal});
  }
  if (method === 'build' && state.projectSystem && state.startupProject && !state.nativeMode) {
    return runProjectBuild(state, compiler, params, {prepare: prepareUnitRequest, finalize: finalizeProjectBuild});
  }
  const request = await prepareProjectRequest(state, method, params);
  const result = await compiler.request(method, request);
  return method === 'build' ? finalizeProjectBuild(state, request, result, {signal: params.signal}) : result;
}

export {hydrateWorkspaceRecords} from './workspace-hydration.js';
