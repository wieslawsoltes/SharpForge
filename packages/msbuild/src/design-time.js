import { dirname, resolve, isAbsolute } from 'node:path';
import { EVALUATION_PROPERTIES, EVALUATION_ITEMS, normalizeBuildRequest } from './contract.js';
import { contextFromEvaluation } from './project-context.js';
import { normalizeWorkspaceContext } from './workspace-context.js';
import { DesignTimeCache } from './design-time-cache.js';
import { collectGeneratedSources } from './design-time-generated.js';
import { evaluationMembershipInputs } from './design-time-inputs.js';

export const DESIGN_TIME_TARGETS = Object.freeze({
  sdk: ['Compile'],
  cps: ['ResolveAssemblyReferencesDesignTime', 'ResolveProjectReferencesDesignTime', 'CompileDesignTime']
});

/** SDK Compile with SkipCompilerExecution produces command lines and generated inputs without emitting the assembly. */
export function createDesignTimeRequest(input) {
  const targets = DESIGN_TIME_TARGETS[input.targetSet ?? 'sdk'];
  if (!targets) throw new Error('Unknown design-time target set');
  return { ...input, action: 'target', targets, resultTargets: targets, designTime: true,
    properties: { ...input.properties, DesignTimeBuild: 'true', SkipCompilerExecution: 'true',
      ProvideCommandLineArgs: 'true', BuildProjectReferences: 'false', BuildingProject: 'false' },
    propertyNames: [...new Set([...EVALUATION_PROPERTIES, 'AllowUnsafeBlocks', 'CompilerGeneratedFilesOutputPath', 'WarningLevel'])],
    itemNames: [...new Set([...EVALUATION_ITEMS, 'ReferencePath', 'CscCommandLineArgs', 'EditorConfigFiles'])] };
}

export class DesignTimeBuildService {
  constructor(engine, { cache = new DesignTimeCache() } = {}) { this.engine = engine; this.cache = cache; this.closed = false; }
  async context(input, { signal } = {}) {
    if (this.closed) throw new Error('Design-time service is closed');
    signal?.throwIfAborted();
    await this.engine.authorize(input);
    const request = normalizeBuildRequest(createDesignTimeRequest(input)), cached = await this.cache.get(request);
    if (cached) return { context: cached, cached: true };
    const started = await this.engine.start(request), abort = () => this.engine.cancel(started.id);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let result;
    try { result = await this.engine.wait(started.id); }
    finally { signal?.removeEventListener('abort', abort); }
    if (result.status !== 'succeeded') {
      throw Object.assign(new Error(result.error ?? 'Design-time evaluation failed'), { code: 'SFMSB_DESIGN_TIME', job: result });
    }
    let context = contextFromEvaluation(input.project, result.result, { diagnostics: result.diagnostics,
      artifacts: result.artifacts, globalProperties: input.properties ?? {} });
    context = normalizeWorkspaceContext(this.engine.workspace, context, await collectGeneratedSources(this.engine.workspace, context));
    const projectPath = await this.engine.workspace.path(input.project);
    const inputs = [projectPath, ...context.imports.map(path => isAbsolute(path) ? path : resolve(this.engine.workspace.root, path)),
      ...context.generatedSources.map(source => resolve(this.engine.workspace.root, source.path)),
      ...await evaluationMembershipInputs(this.engine.workspace)];
    await this.cache.set(request, context, inputs);
    return { context, cached: false, jobId: result.id };
  }
  async contexts(input, options = {}) {
    options.signal?.throwIfAborted();
    const first = await this.engine.start({ ...input, action: 'evaluate', itemNames: [] });
    const abort = () => this.engine.cancel(first.id);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    let result;
    try { result = await this.engine.wait(first.id); }
    finally { options.signal?.removeEventListener('abort', abort); }
    if (result.status !== 'succeeded') throw Object.assign(new Error('Project target discovery failed'), { job: result });
    const properties = result.result.Properties;
    const frameworks = String(properties.TargetFrameworks || properties.TargetFramework || '').split(';').filter(Boolean);
    const runtimes = input.allRuntimes ? String(properties.RuntimeIdentifiers || properties.RuntimeIdentifier || '').split(';') : [input.runtime ?? ''];
    if (frameworks.length * runtimes.length > 128) throw new Error('Project context matrix exceeds 128 cells');
    const contexts = [];
    for (const framework of frameworks.length ? frameworks : ['']) {
      for (const runtime of runtimes) contexts.push((await this.context({ ...input, framework, runtime }, options)).context);
    }
    return contexts;
  }
  close() { this.closed = true; this.cache.clear(); }
}
