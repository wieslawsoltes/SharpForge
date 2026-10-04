import { getCaseInsensitive, projectCompilationOptions, projectContextId, resolveRuntimeIdentifiers } from '@sharpforge/project-system';
export { projectContextId, ProjectContextSelection } from '@sharpforge/project-system';
export { projectContextCompilationOptions, projectContextCompilationInput } from './context-input.js';
import { parseCscArguments } from './csc-args.js';

const split = value => String(value ?? '').split(/[;,]/).map(part => part.trim()).filter(Boolean);
const itemPath = item => typeof item === 'string' ? item : item.FullPath ?? item.Identity ?? item.path;

function immutableContext(context) {
  const result = structuredClone(context);
  const pending = [result];
  const visited = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    if (visited.size >= 100000) throw new Error('Project context object limit exceeded');
    visited.add(value);
    for (const child of Object.values(value)) pending.push(child);
    Object.freeze(value);
  }
  return result;
}

export function createProjectContext(input) {
  if (!input || typeof input.project !== 'string') throw new Error('ProjectContext requires a project path');
  const context = {
    version: 1, project: input.project, configuration: input.configuration ?? 'Debug', platform: input.platform ?? 'AnyCPU',
    targetFramework: input.targetFramework ?? '', runtimeIdentifier: input.runtimeIdentifier ?? '',
    runtimeIdentifiers: input.runtimeIdentifiers ?? [], runtimeFallbackChains: input.runtimeFallbackChains ?? [],
    sources: input.sources ?? [], generatedSources: input.generatedSources ?? [], references: input.references ?? [],
    defines: [...new Set(input.defines ?? [])], langVersion: input.langVersion ?? 'default', nullable: input.nullable ?? 'disable',
    outputKind: input.outputKind ?? 'library', warningLevel: input.warningLevel ?? 4,
    noWarn: input.noWarn ?? [], warningsAsErrors: input.warningsAsErrors ?? [], warningsNotAsErrors: input.warningsNotAsErrors ?? [],
    allWarningsAsErrors: input.allWarningsAsErrors === true,
    unsafe: input.unsafe === true, checked: input.checked === true, analyzers: input.analyzers ?? [],
    additionalFiles: input.additionalFiles ?? [], analyzerConfigFiles: input.analyzerConfigFiles ?? [],
    diagnostics: input.diagnostics ?? [], artifacts: input.artifacts ?? [], unknownCompilerArguments: input.unknownCompilerArguments ?? [],
    backend: input.backend ?? 'portable', properties: input.properties ?? {}, globalProperties: input.globalProperties ?? {}, imports: input.imports ?? [],
    projectReferences: input.projectReferences ?? []
  };
  context.id = projectContextId(context);
  context.diagnostics = context.diagnostics.map(diagnostic => ({ ...diagnostic, contextId: context.id,
    targetFramework: context.targetFramework, runtimeIdentifier: context.runtimeIdentifier }));
  context.artifacts = context.artifacts.map(artifact => ({ ...artifact, contextId: context.id }));
  return immutableContext(context);
}

/** Convert native -getItem/-getProperty output to the browser-safe semantic workspace contract. */
export function contextFromEvaluation(project, evaluation, options = {}) {
  const properties = evaluation.Properties ?? {}, items = evaluation.Items ?? {};
  const runtimes = resolveRuntimeIdentifiers(properties, { graph: options.runtimeGraph });
  const argumentsList = (items.CscCommandLineArgs ?? []).map(itemPath).filter(Boolean);
  const compiler = parseCscArguments(argumentsList);
  const paths = name => (items[name] ?? []).map(itemPath).filter(Boolean);
  const sources = paths('Compile').map(path => ({ path, readOnly: false }));
  return createProjectContext({ ...options, project, backend: 'native', properties,
    configuration: properties.Configuration, platform: properties.Platform,
    targetFramework: properties.TargetFramework, runtimeIdentifier: properties.RuntimeIdentifier,
    runtimeIdentifiers: runtimes.runtimeIdentifiers, runtimeFallbackChains: runtimes.fallbackChains,
    diagnostics: [...options.diagnostics ?? [], ...runtimes.diagnostics],
    sources, references: compiler.references.length ? compiler.references : paths('ReferencePath').map(path => ({ path, aliases: ['global'] })),
    defines: compiler.defines.length ? compiler.defines : split(properties.DefineConstants),
    langVersion: compiler.langVersion ?? properties.LangVersion, nullable: compiler.nullable ?? properties.Nullable,
    outputKind: (properties.OutputType?.toLowerCase() ?? compiler.target) === 'library' ? 'library' : 'exe',
    warningLevel: Number(properties.WarningLevel ?? 4), noWarn: compiler.noWarn,
    warningsAsErrors: compiler.warningsAsErrors, warningsNotAsErrors: compiler.warningsNotAsErrors,
    allWarningsAsErrors: compiler.allWarningsAsErrors,
    unsafe: compiler.unsafe || properties.AllowUnsafeBlocks === 'true', checked: compiler.checked || properties.CheckForOverflowUnderflow === 'true',
    analyzers: [...new Set([...paths('Analyzer'), ...compiler.analyzers])],
    additionalFiles: [...new Set([...paths('AdditionalFiles'), ...compiler.additionalFiles])],
    analyzerConfigFiles: [...new Set([...paths('EditorConfigFiles'), ...compiler.analyzerConfigFiles])],
    imports: split(properties.MSBuildAllProjects), projectReferences: items.ProjectReference ?? [],
    unknownCompilerArguments: compiler.unknown });
}

/** Adapt the portable evaluator to the same IDE context contract without inventing native reference availability. */
export function contextFromPortableEvaluation(evaluation, options = {}) {
  const compiler = projectCompilationOptions(evaluation);
  return createProjectContext({ ...options, project: evaluation.path, backend: 'portable', properties: evaluation.properties,
    configuration: evaluation.effectiveConfiguration, platform: evaluation.effectivePlatform,
    targetFramework: evaluation.targetFramework, runtimeIdentifier: evaluation.properties.runtimeidentifier ?? '',
    runtimeIdentifiers: evaluation.runtimeIdentifiers, runtimeFallbackChains: evaluation.runtimeFallbackChains,
    sources: evaluation.compile.map(source => ({ ...source, readOnly: false })),
    generatedSources: evaluation.generatedSources.map(source => ({ ...source, readOnly: true, generated: true })),
    references: evaluation.references.map(reference => ({ path: reference.hintPath ?? reference.name,
      aliases: String(getCaseInsensitive(reference.metadata, 'Aliases') ?? 'global').split(',') })),
    defines: compiler.defines, langVersion: compiler.langVersion, nullable: compiler.nullable,
    outputKind: compiler.outputKind, warningLevel: compiler.warningLevel, noWarn: compiler.noWarn,
    warningsAsErrors: compiler.warningsAsErrors, warningsNotAsErrors: compiler.warningsNotAsErrors,
    allWarningsAsErrors: compiler.treatWarningsAsErrors,
    unsafe: compiler.allowUnsafe, checked: compiler.checkOverflow, analyzers: evaluation.analyzers,
    additionalFiles: evaluation.additionalFiles, imports: evaluation.imports, projectReferences: evaluation.projectReferences,
    diagnostics: evaluation.diagnostics, artifacts: evaluation.artifacts });
}
