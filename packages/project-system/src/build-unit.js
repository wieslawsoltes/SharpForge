import {projectCompilationOptions} from './evaluation/compiler-options.js';
import {EvaluationError, getCaseInsensitive, toBoolean} from './evaluation/errors.js';
import {buildContextFile} from './evaluation/target-files.js';

function friendAssemblies(project) {
  return (getCaseInsensitive(project.evaluatedItems, 'InternalsVisibleTo') ?? []).map(item => ({
    name: item.identity.split(',')[0].trim(),
    publicKey: getCaseInsensitive(item.metadata, 'Key') ?? getCaseInsensitive(item.metadata, 'PublicKey') ?? '',
  }));
}

function outputPath(project) {
  return project.properties.targetpath ?? '/' + (project.properties.outputpath ?? 'bin/') + project.name + '.dll';
}

/** Materialize one resolved context without reading another context's not-yet-generated inputs. */
export function planBuildUnit(system, node) {
  const project = node.project;
  const sources = project.compile.map(item => {
    const record = buildContextFile(system, item.path, node.id);
    if (typeof record?.text !== 'string') throw new EvaluationError(`Compile source '${item.path}' is missing.`, 'SFP1005');
    return {uri: item.path, path: item.path, text: record.text, version: record.version ?? 1};
  });
  for (const source of project.generatedSources ?? []) sources.push({...source, uri: source.path, version: 1});
  const metadataReferences = project.references.map(reference => {
    const record = reference.hintPath && buildContextFile(system, reference.hintPath, node.id);
    if (record?.lazy) throw new EvaluationError(`Reference '${reference.hintPath}' must be hydrated before compilation.`, 'SFP1101');
    return {...reference, ...(record?.bytes instanceof Uint8Array ? {bytes: record.bytes} : {})};
  });
  const references = node.references.map(edge => {
    const dependency = edge.node.project;
    const {reference} = edge;
    return {project: reference.path, contextId: edge.node.id, targetFramework: dependency.targetFramework,
      assembly: dependency.name, output: outputPath(dependency),
      referenceOutputAssembly: toBoolean(getCaseInsensitive(reference.metadata, 'ReferenceOutputAssembly'), true),
      privateAssets: getCaseInsensitive(reference.metadata, 'PrivateAssets') ?? '',
      aliases: getCaseInsensitive(reference.metadata, 'Aliases') ?? 'global',
      internalsVisible: friendAssemblies(dependency).some(friend => friend.name === project.name)};
  });
  return {
    project: project.path, contextId: node.id, assemblyName: project.name, targetFramework: project.targetFramework,
    runtimeIdentifier: project.runtimeIdentifier ?? '', configuration: project.effectiveConfiguration,
    platform: project.effectivePlatform, output: outputPath(project), sources, options: projectCompilationOptions(project),
    references, metadataReferences, packageReferences: project.packageReferences,
    resources: project.resources ?? [], assemblyAttributes: project.assemblyAttributes ?? [], internalsVisibleTo: friendAssemblies(project),
    internalVisibility: 'assembly', diagnostics: project.diagnostics ?? system.diagnostics.filter(diagnostic => diagnostic.path === project.path),
  };
}
