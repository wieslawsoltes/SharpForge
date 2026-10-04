import {projectContextCompilationInput} from '@sharpforge/msbuild';
import {decodeNativeMetadata} from './metadata.js';

/** Native evaluation and hydration are separate phases; selection only commits a complete, current input set. */
export class NativeProjectContexts {
  constructor(host) {
    this.host = host;
    this.project = '';
    this.contexts = [];
    this.active = null;
    this.compilation = null;
    this.diagnostics = [];
    this.generation = 0;
  }

  reset(workspace) {
    this.generation++;
    this.project = workspace?.projects?.find(path => /\.csproj$/i.test(path)) ?? workspace?.projects?.[0] ?? '';
    this.contexts = [];
    this.active = null;
    this.compilation = null;
    this.diagnostics = [];
  }

  setProject(project) {
    if (!this.host.workspace?.projects?.includes(project)) throw new Error('Select a project from the connected workspace');
    if (project === this.project) return;
    this.reset({projects: [project]});
    this.host.profiles.reset();
    this.host.renderBuild(true);
  }

  request(context = this.active) {
    const request = this.host.request('evaluate');
    return {...request, project: this.project, framework: context?.targetFramework ?? request.framework,
      runtime: context?.runtimeIdentifier ?? request.runtime, configuration: context?.configuration ?? request.configuration,
      platform: context?.platform ?? request.platform, properties: context?.globalProperties ?? request.properties};
  }

  async load() {
    return this.host.operation('Load project contexts', async signal => {
      if (!this.project) throw new Error('Select a native project first');
      if (!this.host.client.projectContexts) throw new Error('This native host does not expose project contexts');
      await this.host.attach();
      const generation = ++this.generation;
      const contexts = await this.host.client.projectContexts(this.request(null), {signal});
      signal.throwIfAborted();
      if (!Array.isArray(contexts) || !contexts.length || contexts.length > 128) throw new Error('Native host returned no usable project contexts');
      if (contexts.some(context => context.project !== this.project || !context.id)) throw new Error('Native context project mismatch');
      const active = contexts.find(context => context.id === this.active?.id) ??
        contexts.find(context => context.targetFramework === this.host.settings.framework &&
          context.runtimeIdentifier === this.host.settings.runtime) ?? contexts[0];
      const compilation = await this.hydrate(active, signal);
      await this.commit(active, compilation, generation, signal);
      this.contexts = contexts;
      this.diagnostics = contexts.flatMap(context => context.diagnostics ?? []);
      this.host.renderBuild(true);
      return this.snapshot();
    });
  }

  async select(id) {
    const context = this.contexts.find(value => value.id === id);
    if (!context) throw new Error('Select an evaluated project context');
    return this.host.operation('Select project context', async signal => {
      await this.host.attach();
      const generation = ++this.generation;
      const compilation = await this.hydrate(context, signal);
      await this.commit(context, compilation, generation, signal);
      this.host.renderBuild(true);
      return this.snapshot();
    });
  }

  async hydrate(context, signal) {
    if (!this.host.client.projectMetadata) throw new Error('The native host needs project metadata support before semantic hydration');
    const records = [];
    const inputs = [...context.sources, ...context.generatedSources];
    if (inputs.length > 20000) throw new Error('Native source count limit exceeded');
    let total = 0;
    for (const source of inputs) {
      signal.throwIfAborted();
      if (source.external) continue;
      const file = typeof source.text === 'string' ? source : await this.host.client.read(source.path);
      if (typeof file.text !== 'string' || (total += file.text.length) > 32 * 1024 * 1024) {
        throw new Error('Native source text limit exceeded');
      }
      records.push({...source, ...file, uri: source.path, path: source.path,
        readOnly: source.readOnly === true || source.generated === true, generated: source.generated === true});
    }
    const response = await this.host.client.projectMetadata(this.request(context), {signal});
    const references = await decodeNativeMetadata(response, context.id, {signal});
    const compilation = projectContextCompilationInput(context, records);
    const originals = new Map(records.map(record => [record.path, record]));
    return {...compilation, files: compilation.files.map(file => ({...originals.get(file.uri), ...file})),
      options: {...compilation.options, references}, references,
      diagnostics: [...compilation.diagnostics, ...inputs.filter(source => source.external).map(source => ({
        code: 'SFMSB_CONTEXT_SOURCE_OUTSIDE_ROOT', severity: 'warning', file: source.path, contextId: context.id,
        message: 'Source is outside the connected workspace; open a containing workspace to hydrate this document.'
      }))]};
  }

  async commit(context, compilation, generation, signal) {
    signal.throwIfAborted();
    if (generation !== this.generation) throw new Error('Native context changed while loading; retry');
    await this.host.onProjectContext?.({context, compilation, signal});
    signal.throwIfAborted();
    if (generation !== this.generation) throw new Error('Native context changed before activation');
    this.active = context;
    this.compilation = compilation;
    Object.assign(this.host.settings, {framework: context.targetFramework, runtime: context.runtimeIdentifier,
      configuration: context.configuration, platform: context.platform});
  }

  snapshot() {
    return {project: this.project, active: this.active?.id ?? null, contexts: this.contexts,
      sourceCount: this.compilation?.files.length ?? 0, referenceCount: this.compilation?.references.length ?? 0,
      diagnostics: this.diagnostics};
  }
}
