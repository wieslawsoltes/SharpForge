import { parseXml } from '../xml.js';
import { EvaluationContext } from './context.js';
import { WorkspacePathIndex } from './path-index.js';
import { EvaluationError, splitList, formatValue, getCaseInsensitive, fail } from './errors.js';
import { createTargetGraph } from './targets.js';
import { evaluationResult } from './result.js';
import { itemList } from './items.js';
import { setProperty } from './properties.js';
import { batchInvocations, withBatch } from './target-batching.js';
import { virtualTaskHandlers } from './virtual-tasks.js';
import { tagContext } from '../multi-target.js';
import { projectWithContexts } from '../context-selection.js';
import { restoreTargetFiles, addCompilerOutputs, captureTargetFiles } from './target-files.js';

function outputItems(context, name, values) {
  const list = itemList(context, name);
  for (const value of Array.isArray(values) ? values : splitList(formatValue(values))) list.push({
    itemType: name, identity: formatValue(value), path: context.resolvePath(formatValue(value)),
    metadata: {}, definingProject: context.currentFile, implicit: false,
  });
}

function taskOutputs(context, node, result) {
  for (const output of node.children.filter(child => child.name === 'Output')) {
    if (!context.enabled(output)) continue;
    const parameter = context.expand(output.attributes.TaskParameter ?? '');
    const value = getCaseInsensitive(result, parameter);
    if (value === undefined) fail(`Task '${node.name}' has no output parameter '${parameter}'.`, 'MSB4131');
    if (output.attributes.PropertyName) setProperty(context, context.expand(output.attributes.PropertyName), formatValue(value), output);
    if (output.attributes.ItemName) outputItems(context, context.expand(output.attributes.ItemName), value);
  }
}

function executeTask(context, node, runner) {
  for (const batch of batchInvocations(context, Object.values(node.attributes))) withBatch(context, batch, () => {
    context.step();
    if (!context.enabled(node)) return;
    const mode = context.expand(node.attributes.ContinueOnError ?? 'ErrorAndStop');
    if (!['ErrorAndStop', 'ErrorAndContinue', 'WarnAndContinue', 'true', 'false'].includes(mode)) fail(`Invalid ContinueOnError '${mode}'.`, 'MSB4064');
    try {
      const handler = virtualTaskHandlers[node.name];
      if (!handler) fail(`Task '${node.name}' requires native MSBuild.`, 'SFP1004');
      const result = handler(context, node, runner);
      taskOutputs(context, node, result);
    } catch (error) {
      if (['SFP1099', 'MSB0001'].includes(error.code) || error.requiredFiles?.length) throw error;
      const warning = ['WarnAndContinue', 'true'].includes(mode);
      context.diagnostic(error, node, undefined, warning ? 'warning' : 'error');
      if (['ErrorAndStop', 'false'].includes(mode)) throw error;
    }
  });
}

function cloneContext(system, startup, options) {
  const original = options.contextId ? system.evaluationContextVariants.get(options.contextId) : system.evaluationContexts.get(startup);
  if (!original || original.path !== startup) throw new EvaluationError('Project context must be evaluated before running portable targets.', 'SFP1801');
  const initial = original.initialContext ?? original;
  const source = options.phase === 'beforeCompile' ? initial : original;
  const virtual = Object.create(system);
  virtual.files = new Map([...system.files].map(([path, file]) => [path, { ...file }]));
  restoreTargetFiles(virtual.files, original.targetFiles);
  const diagnostics = options.phase === 'afterCompile' ? original.system.diagnostics : initial.evaluationDiagnostics ?? [];
  virtual.diagnostics = diagnostics.map(diagnostic => ({...diagnostic}));
  virtual.options = { ...system.options, signal: options.signal ?? system.options.signal,
    limits: { ...system.options.limits, steps: options.maxSteps ?? 100000 } };
  virtual.pathIndex = new WorkspacePathIndex(virtual.files.keys(), system.options);
  const root = parseXml(system.text(startup));
  const context = new EvaluationContext(virtual, startup, root);
  Object.assign(context.properties, source.properties);
  context.items = Object.fromEntries(Object.entries(source.items).map(([type, items]) => [type,
    items.map(item => ({ ...item, metadata: { ...item.metadata } }))]));
  for (const key of ['definitions', 'targets', 'usingTasks', 'targetAttributes', 'sdkModels', 'imports', 'importRecords', 'sdkImports']) {
    context[key] = source[key];
  }
  context.localProperties = new Set(source.localProperties);
  context.globals = new Set(source.globals);
  context.contextId = original.contextId;
  context.initialContext = initial;
  context.evaluationDiagnostics = initial.evaluationDiagnostics;
  context.targetFiles = new Map(original.targetFiles ?? []);
  context.pendingBuild = options.phase === 'beforeCompile' ? null : original.pendingBuild;
  if (options.phase === 'afterCompile') context.steps = original.steps;
  return { context, virtual, root };
}

function applyContextResult(system, context, virtual, project) {
  const previous = system.projects.get(project.path);
  const contexts = (previous.contexts ?? [previous]).map(value => value.contextId === project.contextId ? project : value);
  const active = contexts.find(value => value.contextId === previous.activeContextId) ?? project;
  system.files = virtual.files;
  system.pathIndex = virtual.pathIndex;
  system.contextSelection.update(contexts);
  system.projects.set(project.path, projectWithContexts(contexts, active, previous.runtimeIdentifiers));
  system.evaluationContextVariants.set(project.contextId, context);
  if (active.contextId === project.contextId) system.evaluationContexts.set(project.path, context);
  system.diagnostics = system.diagnostics.filter(diagnostic => diagnostic.contextId !== project.contextId);
  system.diagnostics.push(...project.diagnostics);
}

/** Execute only registered portable tasks against a copied virtual workspace, bounded by steps and output bytes. */
export function runPortableTargets(system, startup, requested, options = {}) {
  if (options.phase !== undefined && !['beforeCompile', 'afterCompile'].includes(options.phase)) {
    fail('Unknown portable target execution phase.', 'SFP1803');
  }
  const { context, virtual, root } = cloneContext(system, startup, options);
  const completing = options.phase === 'afterCompile';
  const buildRoot = options.phase === 'beforeCompile' && context.targets.some(target => target.buildStage === 'compile') ? 'Build' : undefined;
  const graph = completing ? context.pendingBuild?.graph : createTargetGraph(context, requested ?? buildRoot);
  if (!graph) fail('Post-compilation targets require a prepared context.', 'SFP1803');
  const lookup = new Map(graph.targets.map(target => [target.name.toLowerCase(), target]));
  const runner = { messages: [], changed: new Set(), directories: new Set(), outputBytes: 0,
    maxOutputBytes: options.maxOutputBytes ?? 16 * 1024 * 1024, logicalTime: options.logicalTime ?? 1, callTarget: null };
  const completed = new Set(completing ? context.pendingBuild.completed : []);
  const active = new Set();
  const executed = [];
  const compilerBoundary = Symbol('compiler boundary');
  let boundary = null;
  let success = true;
  const execute = name => {
    context.step();
    const key = name.toLowerCase();
    if (active.has(key)) fail(`CallTarget recursion contains '${name}'.`, 'MSB4006');
    if (completed.has(key)) return;
    if (active.size >= (options.maxDepth ?? 64)) fail('Target recursion limit exceeded.', 'MSB0001');
    const target = lookup.get(key);
    if (!target) fail(`Target '${name}' does not exist.`, 'MSB4057');
    active.add(key);
    context.withFile(target.file, () => {
      for (const dependency of target.dependsOnTargets) execute(dependency);
      for (const batch of batchInvocations(context, [target.attributes.Inputs ?? '', target.attributes.Outputs ?? ''])) {
        withBatch(context, batch, () => {
          if (!context.enabled(target)) return;
          for (const task of target.nodes) executeTask(context, task, runner);
        });
      }
    });
    active.delete(key);
    if (target.buildStage === 'compile' && !completing) {
      boundary = target.name;
      throw compilerBoundary;
    }
    completed.add(key);
    executed.push(target.name);
  };
  runner.callTarget = execute;
  try {
    if (completing) {
      addCompilerOutputs(context, options);
      if (context.pendingBuild.boundary) {
        completed.add(context.pendingBuild.boundary.toLowerCase());
        executed.push(context.pendingBuild.boundary);
      }
    }
    for (const name of graph.order) execute(name);
  } catch (error) {
    if (error !== compilerBoundary) { success = false; context.diagnostic(error, null); }
  }
  if (success) {
    context.pendingBuild = !completing && (boundary || options.phase === 'beforeCompile')
      ? {graph, completed: [...completed], boundary} : null;
    captureTargetFiles(context, runner.changed);
  }
  const project = tagContext(evaluationResult(context, root), context, virtual.diagnostics);
  success &&= !project.diagnostics.some(diagnostic => diagnostic.severity === 'error');
  if (options.apply !== false && success) {
    applyContextResult(system, context, virtual, project);
  }
  const requiredFiles = [...new Set(project.diagnostics.flatMap(diagnostic => diagnostic.requiredFiles ?? []))];
  return { success, project, contextId: project.contextId, requiredFiles, executed, messages: runner.messages,
    awaitingCompilation: success && !!context.pendingBuild, diagnostics: [...project.diagnostics],
    files: [...virtual.files.values()], changedFiles: [...runner.changed], directories: [...runner.directories],
    outputBytes: runner.outputBytes, steps: context.steps, applied: success && options.apply !== false };
}
