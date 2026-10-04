const sessions = new WeakMap();
const latest = new WeakMap();
const keyOf = value => value.contextId ?? value.project ?? value.path;

/** Reject a cancelled request or a result from a retired workspace revision. */
export function assertProjectCurrent(state, system, revision, signal, identity = {}) {
  if (signal?.aborted) throw new DOMException('Project preparation cancelled', 'AbortError');
  const replaced = ['disk', 'startupProject', 'workspaceEpoch', 'nativeMode']
    .some(key => Object.hasOwn(identity, key) && state[key] !== identity[key]);
  if (state.projectSystem !== system || state.revision !== revision || replaced) {
    throw new Error('Workspace changed while preparing compilation; retry the build');
  }
}

export function selectedBuildProjects(state) {
  const system = state.projectSystem;
  if (typeof system.buildContexts === 'function') return system.buildContexts(state.startupProject);
  return system.closure(state.startupProject).map(path => system.projects.get(path)).filter(project => project && !project.unloaded);
}

/** A new explicit build supersedes any pending build of this project system. */
export function beginProjectBuild(state) {
  const session = {system: state.projectSystem, revision: state.revision, startupProject: state.startupProject,
    workspaceEpoch: state.workspaceEpoch, nativeMode: state.nativeMode, disk: state.disk, token: Symbol('project build'), prepared: []};
  latest.set(session.system, session.token);
  return session;
}

export function assertBuildSession(state, session, signal) {
  assertProjectCurrent(state, session.system, session.revision, signal, session);
  if (latest.get(session.system) !== session.token) throw new Error('A newer project build superseded this request');
}

export function setHydratedBuildFile(system, path, record, contextId) {
  if (system.setBuildFile) system.setBuildFile(path, record, {contextId});
  else system.files.set(path, record);
}

export function contextFile(system, path, contextId) {
  return system.buildFile ? system.buildFile(path, {contextId}) : system.files.get(path);
}

async function runPhase(state, session, project, options, signal) {
  const {system} = session;
  const hydrated = new Set();
  const contextId = project.contextId ?? project.id;
  for (let attempt = 0; attempt <= Math.min(system.files.size, 20000); attempt++) {
    assertBuildSession(state, session, signal);
    const result = system.runTargets(project.path ?? project.project, undefined, {...options, apply: true, signal, contextId});
    assertBuildSession(state, session, signal);
    if (result.success) return result;
    const required = [...new Set(result.requiredFiles ?? [])].filter(path => contextFile(system, path, contextId)?.lazy && !hydrated.has(path));
    if (!required.length || !state.disk?.load) {
      const error = new Error(result.diagnostics.map(item => item.message).join('\n') || 'Portable target execution failed');
      error.code = 'SFP1802';
      error.diagnostics = result.diagnostics;
      throw error;
    }
    for (const path of required) {
      assertBuildSession(state, session, signal);
      const record = await state.disk.load(path, {signal});
      assertBuildSession(state, session, signal);
      setHydratedBuildFile(system, path, record, contextId);
      hydrated.add(path);
    }
  }
  throw new Error('Portable target hydration exceeded the workspace file limit');
}

/** Each context snapshots its virtual outputs before preparation moves to the next context. */
export async function prepareBuildTargets(state, session, signal) {
  const prepared = new Set();
  for (;;) {
    assertBuildSession(state, session, signal);
    const project = selectedBuildProjects(state).find(context => !prepared.has(keyOf(context)));
    if (!project) break;
    if (prepared.size >= 512) throw new RangeError('Project preparation graph limit exceeded');
    await prepareBuildContext(state, session, project, signal);
    prepared.add(keyOf(project));
  }
  state.projectSnapshot = session.system.snapshot();
}

/** Prepare one graph context, retaining its output snapshot before any other context runs. */
export async function prepareBuildContext(state, session, project, signal) {
  const result = await runPhase(state, session, project, {phase: 'beforeCompile'}, signal);
  session.prepared.push({project: project.path, contextId: project.contextId, phase: 'beforeCompile', executed: result.executed,
    messages: result.messages, changedFiles: result.changedFiles});
  state.projectSnapshot = session.system.snapshot();
  return result.project;
}

export function attachProjectBuild(request, session) {
  const contexts = new Set(request.buildPlan.units.map(keyOf));
  sessions.set(request, {...session, prepared: session.prepared.filter(project => contexts.has(keyOf(project)))});
  return request;
}

function compilerOutputs(unit, artifact) {
  const outputs = [{path: unit.output, bytes: artifact.assembly}];
  if (artifact.pdb?.length) outputs.push({path: unit.output.replace(/\.[^/.]+$/, '') + '.pdb', bytes: artifact.pdb});
  for (const satellite of artifact.satellites ?? []) outputs.push({path: satellite.output, bytes: satellite.assembly});
  return outputs;
}

/** Failed compilation never publishes an assembly path or runs that context's after targets. */
export async function finalizeBuildTargets(state, request, result, {signal} = {}) {
  const session = sessions.get(request);
  if (!session) return result;
  sessions.delete(request);
  assertBuildSession(state, session, signal);
  const diagnostics = [...(result.diagnostics ?? [])];
  const artifacts = (result.projectArtifacts ?? []).map(artifact => ({...artifact}));
  if (result.success && request.buildPlan.units.some(unit => !artifacts.some(artifact => keyOf(artifact) === keyOf(unit)))) {
    throw new Error('Successful project compilation did not return every prepared context artifact');
  }
  const targetResults = [...session.prepared];
  let failedAfter = false;
  for (const unit of request.buildPlan.units) {
    const artifact = artifacts.find(value => keyOf(value) === keyOf(unit));
    if (!artifact?.success) continue;
    if (failedAfter) {
      artifact.success = false;
      artifact.targetsCompleted = false;
      continue;
    }
    if (!(artifact.assembly instanceof Uint8Array) || !artifact.assembly.length) {
      throw new Error('Successful compilation did not return assembly bytes: ' + unit.project);
    }
    try {
      const after = await runPhase(state, session, unit,
        {phase: 'afterCompile', outputPath: unit.output, outputs: compilerOutputs(unit, artifact)}, signal);
      artifact.targetsCompleted = true;
      targetResults.push({project: unit.project, contextId: unit.contextId, phase: 'afterCompile', executed: after.executed,
        messages: after.messages, changedFiles: after.changedFiles});
      for (const diagnostic of after.diagnostics) if (!diagnostics.some(value => value.contextId === diagnostic.contextId
        && value.code === diagnostic.code && value.message === diagnostic.message)) diagnostics.push(diagnostic);
    } catch (error) {
      assertBuildSession(state, session, signal);
      artifact.success = false;
      artifact.targetsCompleted = false;
      diagnostics.push(...(error.diagnostics ?? [{code: error.code ?? 'SFP1802', message: error.message,
        severity: 'error', project: unit.project, path: unit.project, uri: unit.project, contextId: unit.contextId, start: 0, length: 1}]));
      failedAfter = true;
    }
  }
  assertBuildSession(state, session, signal);
  state.projectSnapshot = session.system.snapshot();
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const success = result.success && !errors && artifacts.every(artifact => artifact.success);
  return {...result, success, diagnostics, projectArtifacts: artifacts, targetResults,
    outputLayout: session.system.outputLayout(state.startupProject), metrics: {...result.metrics, errors},
    ...(!success ? {image: null, assembly: null, pdb: null} : {})};
}
