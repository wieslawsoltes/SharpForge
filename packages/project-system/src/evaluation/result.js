import { getCaseInsensitive, splitList, toBoolean, unescape } from './errors.js';
import { generateSdkSources } from './sdk/generated-sources.js';
import { createTargetGraph } from './targets.js';
import { evaluateResources } from '../resources.js';
import { readLaunchSettings } from '../launch-settings.js';

const metadata = item => ({ ...item.metadata });

/** Adapt ordered evaluation records to the existing public snapshot plus richer per-project build data. */
export function evaluationResult(context, root) {
  const items = type => getCaseInsensitive(context.items, type) ?? [];
  const properties = Object.fromEntries(Object.entries(context.properties).map(([key, value]) => [key, unescape(value)]));
  const compile = new Map();
  for (const item of items('Compile')) {
    const data = metadata(item);
    compile.set(item.path, { path: item.path, link: getCaseInsensitive(data, 'Link') ?? null,
      ...(Object.keys(data).length ? { metadata: data } : {}) });
    if (typeof context.files.get(item.path)?.text !== 'string' && context.files.get(item.path)?.lazy !== true) {
      context.diagnostic(`Compile file '${item.path}' is missing. Open the containing folder or select all referenced files.`, null, 'SFP1005');
    }
  }
  const allProjectReferences = items('ProjectReference').map(item => ({ path: item.path, metadata: metadata(item) }));
  const projectReferences = allProjectReferences.filter(item => toBoolean(getCaseInsensitive(item.metadata, 'ReferenceOutputAssembly'), true));
  const references = items('Reference').map(item => ({ name: item.identity, metadata: metadata(item),
    hintPath: getCaseInsensitive(item.metadata, 'HintPath') ? context.resolvePath(getCaseInsensitive(item.metadata, 'HintPath')) : null }));
  const packageReferences = items('PackageReference').map(item => ({ name: item.identity, version: getCaseInsensitive(item.metadata, 'Version') ?? '',
    metadata: metadata(item) }));
  for (const reference of references) {
    const file = reference.hintPath && context.files.get(reference.hintPath);
    if (!(file?.bytes instanceof Uint8Array) && !file?.lazy) {
      context.diagnostic(`Binary reference '${reference.name}' requires a readable HintPath assembly or native MSBuild resolution.`,
        null, 'SFP1101');
    }
  }
  for (const reference of packageReferences) context.diagnostic(`Package '${reference.name}' is recorded; restore/linking require native MSBuild.`,
    null, 'SFP1102');
  const analyzers = items('Analyzer').map(item => item.path);
  if (analyzers.length) context.diagnostic('Roslyn Analyzer DLLs require the native toolchain; JavaScript extensions use the extension host.', null, 'SFP1103');
  const frameworks = splitList(properties.targetframeworks ?? properties.targetframework ?? '');
  let targetGraph = { targets: [], order: [], initialTargets: [], defaultTargets: [] };
  try { targetGraph = createTargetGraph(context); }
  catch (error) { context.diagnostic(error, root); }
  const generatedSources = generateSdkSources(context);
  const launchPath = context.resolvePath('Properties/launchSettings.json');
  const launchSettings = context.files.has(launchPath) ? readLaunchSettings(context.files.get(launchPath).text, {
    path: launchPath, profile: context.system.options?.launchProfile,
  }) : { path: launchPath, profiles: [], activeProfile: null, diagnostics: [] };
  for (const diagnostic of launchSettings.diagnostics) context.system.diagnostics.push(diagnostic);
  const commonTypes = new Set(['Compile', 'ProjectReference', 'Reference', 'PackageReference', 'AdditionalFiles', 'Analyzer']);
  return {
    path: context.path, name: properties.assemblyname ?? properties.msbuildprojectname,
    sdk: root.attributes.Sdk ?? context.sdkModels.map(model => model.name).join(';'),
    properties, effectiveConfiguration: properties.configuration, effectivePlatform: properties.platform,
    imports: [...context.imports], importRecords: [...context.importRecords], sdkImports: [...context.sdkImports],
    targets: context.targets.map(({ nodes, ...target }) => target), targetGraph, usingTasks: [...context.usingTasks],
    itemDefinitions: context.definitions, evaluatedItems: context.items,
    targetFramework: properties.targetframework ?? frameworks[0] ?? '', targetFrameworks: frameworks,
    outputType: properties.outputtype ?? 'Library', compile: [...compile.values()], allProjectReferences, projectReferences,
    references, packageReferences, additionalFiles: items('AdditionalFiles').map(item => item.path), analyzers,
    items: Object.values(context.items).flat().filter(item => !commonTypes.has(item.itemType))
      .map(item => ({ path: item.path, identity: item.identity, itemType: item.itemType, metadata: metadata(item) })),
    generatedSources, generatedDocuments: generatedSources,
    assemblyAttributes: generatedSources.flatMap(source => source.assemblyAttributes ?? []),
    resources: evaluateResources(context), launchSettings,
    evaluationStatistics: { steps: context.steps, pathQueries: { ...context.pathIndex.counters } },
  };
}
