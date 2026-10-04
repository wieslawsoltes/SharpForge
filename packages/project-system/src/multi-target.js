import { evaluatePortableProject } from './evaluation/index.js';
import { EvaluationError, getCaseInsensitive, splitList } from './evaluation/errors.js';
import { findProjectContext, projectContextId, projectWithContexts } from './context-selection.js';
import { resolveRuntimeIdentifiers } from './rid.js';

function withoutFramework(properties = {}) {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => key.toLowerCase() !== 'targetframework'));
}

function evaluationSystem(system, path, selection, targetFramework) {
  const projectProperties = withoutFramework(system.options.projectProperties?.[path]);
  for (const key of ['configuration', 'platform', 'runtimeIdentifier']) {
    if (selection[key] !== undefined) projectProperties[key] = selection[key];
  }
  return {
    files: system.files,
    pathIndex: system.pathIndex,
    configuration: selection.configuration ?? system.configuration,
    platform: selection.platform ?? system.platform,
    targetFramework,
    globalProperties: withoutFramework(system.globalProperties),
    options: { ...system.options, projectProperties: { ...system.options.projectProperties, [path]: projectProperties } },
    evaluationContexts: new Map(),
    diagnostics: [],
    diagnostic: system.diagnostic,
    text: path => system.text(path),
  };
}

export function tagContext(project, evaluation, diagnostics) {
  const runtimes = resolveRuntimeIdentifiers(project.properties, { graph: evaluation.system.options.runtimeGraph });
  const context = { ...project, project: project.path, configuration: project.effectiveConfiguration,
    platform: project.effectivePlatform, runtimeIdentifier: runtimes.runtimeIdentifier,
    runtimeIdentifiers: runtimes.runtimeIdentifiers, runtimeFallbackChains: runtimes.fallbackChains };
  context.id = projectContextId(context);
  context.contextId = context.id;
  context.diagnostics = [...diagnostics, ...runtimes.diagnostics].map(diagnostic => ({ ...diagnostic,
    path: diagnostic.path ?? project.path, project: project.path, contextId: context.id,
    targetFramework: context.targetFramework, runtimeIdentifier: context.runtimeIdentifier }));
  context.generatedSources = project.generatedSources.map(source => ({ ...source, contextId: context.id }));
  context.generatedDocuments = context.generatedSources;
  context.resources = project.resources.map(resource => ({ ...resource, contextId: context.id }));
  context.launchSettings = { ...project.launchSettings, contextId: context.id };
  evaluation.contextId = context.id;
  return context;
}

/** Discover frameworks once, then evaluate each inner build with independent properties, items and diagnostics. */
export function evaluateProjectContexts(system, path) {
  const selection = system.contextOptions.get(path) ?? {};
  const outerSystem = evaluationSystem(system, path, selection, '');
  const outer = evaluatePortableProject(outerSystem, path);
  const frameworks = [...new Set(splitList(outer.properties.targetframeworks))];
  const targetFramework = (selection.targetFramework ?? system.targetFramework)
    || getCaseInsensitive(system.options.projectProperties?.[path], 'TargetFramework')
    || system.globalProperties.targetframework || outer.properties.targetframework || frameworks[0] || '';
  const targets = frameworks.length ? frameworks : [targetFramework || outer.properties.targetframework || ''];
  if (targets.length > (system.options.limits?.frameworks ?? 32)) {
    throw new EvaluationError('Target-framework context limit exceeded.', 'SFP1903');
  }
  const contexts = [];
  const evaluations = new Map();
  for (const framework of targets) {
    const reuseOuter = !frameworks.length && framework === outer.targetFramework;
    const child = reuseOuter ? outerSystem : evaluationSystem(system, path, selection, framework);
    const project = reuseOuter ? outer : evaluatePortableProject(child, path);
    const evaluation = child.evaluationContexts.get(path);
    const context = tagContext(project, evaluation, child.diagnostics);
    contexts.push(context);
    evaluations.set(context.id, evaluation);
  }
  const active = findProjectContext(contexts, { targetFramework, runtimeIdentifier: selection.runtimeIdentifier });
  if (!active) throw new EvaluationError(`Requested target framework '${targetFramework}' is not declared by '${path}'.`, 'SFP1903');
  system.contextSelection.update(contexts);
  system.contextSelection.select(path, active.id);
  for (const [id, evaluation] of system.evaluationContextVariants) {
    if (evaluation.path === path) system.evaluationContextVariants.delete(id);
  }
  for (const [id, evaluation] of evaluations) system.evaluationContextVariants.set(id, evaluation);
  system.evaluationContexts.set(path, evaluations.get(active.id));
  system.diagnostics = system.diagnostics.filter(diagnostic => diagnostic.project !== path && diagnostic.path !== path);
  system.diagnostics.push(...contexts.flatMap(context => context.diagnostics));
  return projectWithContexts(contexts, active, active.runtimeIdentifiers);
}
