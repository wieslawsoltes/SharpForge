import {resolveBuildContextGraph} from '@sharpforge/project-system';
import {beginProjectBuild, assertBuildSession} from './project-targets.js';
import {rememberProjectArtifacts} from './project-artifacts.js';

const keyOf = value => value.contextId ?? value.project;

function blockedContext(node, missing) {
  const project = node.project.path;
  const diagnostic = {code: 'SFP1901', severity: 'error', project, path: project, uri: project,
    contextId: node.id, start: 0, length: 1, message: 'Dependencies did not complete successfully: ' + missing.join(', ')};
  const unit = {project, contextId: node.id, sources: [], references: []};
  return {unit, result: {success: false, image: null, assembly: null, pdb: null, diagnostics: [diagnostic],
    metrics: {errors: 1}, projectArtifacts: [{project, contextId: node.id, success: false, targetsCompleted: false}]}};
}

function combineResults(state, graph, entries) {
  const ordered = graph.nodes.map(node => entries.get(node.id));
  const startup = entries.get(graph.startupContextId)?.result;
  if (!startup) throw new Error('The selected startup context did not complete');
  const diagnostics = ordered.flatMap(entry => entry.result.diagnostics ?? []);
  const projectArtifacts = ordered.flatMap(entry => entry.result.projectArtifacts ?? []);
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const success = !errors && ordered.every(entry => entry.result.success);
  const result = {...startup, success, diagnostics, projectArtifacts,
    targetResults: ordered.flatMap(entry => entry.result.targetResults ?? []),
    generatedSources: ordered.flatMap(entry => (entry.result.generatedSources ?? []).map(source =>
      ({...source, project: entry.unit.project, contextId: entry.unit.contextId}))),
    outputLayout: state.projectSystem.outputLayout(state.startupProject),
    metrics: {...startup.metrics, errors, projects: ordered.length, files: ordered.reduce((sum, entry) => sum + entry.unit.sources.length, 0)},
    ...(!success ? {image: null, assembly: null, pdb: null} : {})};
  rememberProjectArtifacts(state.projectSystem, {units: ordered.map(entry => entry.unit)}, result);
  return result;
}

function assertCompiledGraph(graph, entries) {
  for (const node of graph.nodes) {
    const entry = entries.get(node.id);
    if (!entry?.result.success) continue;
    const dependencies = node.references.map(edge => edge.node.id);
    if (JSON.stringify(dependencies) !== JSON.stringify(entry.unit.references.map(keyOf))) {
      throw new Error('Project dependencies changed after compilation; reevaluate the workspace and retry the build');
    }
  }
}

/** Finish each dependency's portable targets before preparing its consumer, reusing actual emitted artifact bytes. */
export async function runProjectBuild(state, compiler, params, {prepare, finalize}) {
  const session = beginProjectBuild(state);
  const entries = new Map();
  for (;;) {
    assertBuildSession(state, session, params.signal);
    const graph = resolveBuildContextGraph(session.system, state.startupProject);
    assertCompiledGraph(graph, entries);
    const node = graph.nodes.find(value => !entries.has(value.id));
    if (!node) return combineResults(state, graph, entries);
    if (entries.size >= 512) throw new RangeError('Project compilation context limit exceeded');
    const missing = node.references.filter(edge => !entries.get(edge.node.id)?.result.success).map(edge => edge.node.project.path);
    if (missing.length) { entries.set(node.id, blockedContext(node, missing)); continue; }
    const prior = [...entries.values()].flatMap(entry => entry.result.projectArtifacts ?? []);
    const request = await prepare(state, node.project, session, prior, params);
    assertBuildSession(state, session, params.signal);
    const unit = request.buildPlan.units[0];
    if (unit.references.some(reference => !entries.has(keyOf(reference)))) {
      throw new Error('Project dependencies changed during preparation; reevaluate the workspace and retry the build');
    }
    const compiled = await compiler.request('build', request);
    assertBuildSession(state, session, params.signal);
    const result = await finalize(state, request, compiled, {signal: params.signal});
    entries.set(node.id, {unit, result});
  }
}
