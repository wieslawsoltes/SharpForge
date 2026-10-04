import {Workspace} from '@sharpforge/workspace';
import {emitAssemblyDetailed, CilError} from '@sharpforge/cil';
import {emitPortablePdb, attachPortablePdb} from '@sharpforge/symbols';
import {SourceText, diagnostic} from '@sharpforge/text';
import {getCaseInsensitive} from '@sharpforge/project-system';
import {sourceTypeDefinitions, sourceMemberDefinitions, projectEmissionInputs, emitProjectSatellites} from './project-emission.js';
import {projectContextKey as contextKey, projectDependencyArtifacts, validateProjectPlan} from './project-plan-input.js';
import {createAssemblyArtifactCache} from './assembly-artifact-cache.js';

const artifactCache = createAssemblyArtifactCache();

function emitted(result, name, options) {
  const cached = artifactCache.get(result.image, name, options);
  if (cached) return {...cached, metrics: {...cached.metrics, emitIlMs: 0, assemblyCached: true}};
  const artifact = emitAssemblyDetailed(result.image, {name, ...options});
  const pdb = emitPortablePdb(artifact.bytes, artifact.symbolData, {embedSources: true}).bytes;
  const value = {assembly: attachPortablePdb(artifact.bytes, pdb, {path: name + '.pdb', embedded: true}),
    pdb, format: 'cil', metrics: {...artifact.metrics, assemblyCached: false}};
  artifactCache.set(result.image, name, options, value);
  return value;
}

function compileWorkspace(workspace, method, name, emissionOptions) {
  const compiled = workspace.compile();
  const result = {...compiled, image: method === 'build' ? compiled.image : undefined,
    workspaceMetrics: {...workspace.metrics}};
  if (method !== 'build' || !compiled.success) return result;
  try {
    const options = {...emissionOptions, typeDefinitions: sourceTypeDefinitions(workspace, compiled.image),
      memberDefinitions: sourceMemberDefinitions(workspace, compiled.image)};
    const artifact = emitted(compiled, name ?? compiled.image.name, options);
    return {...result, ...artifact, metrics: {...compiled.metrics, ...artifact.metrics}};
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    const first = compiled.image.sources[0] ?? {text: '', uri: '<project>'};
    return {...result, success: false, image: null, assembly: null,
      diagnostics: [...compiled.diagnostics, diagnostic(new SourceText(first.text, first.uri), 0, 1, 'SF3001', error.message)],
      metrics: {...compiled.metrics, errors: (compiled.metrics.errors ?? 0) + 1}};
  }
}

function planError(project, message, code = 'SFP1901') {
  return {path: project, uri: project, start: 0, length: 1, code, severity: 'error', message};
}

/** Execute dependency-ordered units without copying any dependency source into a consuming assembly. */
export function compileProjectPlan(plan, {compileUnit, extensions} = {}) {
  const artifacts = projectDependencyArtifacts(plan);
  validateProjectPlan(plan, artifacts);
  const units = [];
  const diagnostics = [...(plan.diagnostics ?? [])];
  for (const unit of plan.units) {
    const references = [];
    const missing = [];
    for (const reference of unit.references ?? []) {
      const dependency = artifacts.get(contextKey(reference));
      if (!dependency?.success) { missing.push(reference.project); continue; }
      if (reference.referenceOutputAssembly !== false) references.push({bytes: dependency.assembly,
        display: reference.output, aliases: String(reference.aliases ?? 'global').split(/[;,]/).filter(Boolean), runtimeProfile: 'sharpforge'});
    }
    const external = (unit.metadataReferences ?? []).filter(reference => reference.bytes).map(reference => ({
      bytes: reference.bytes, display: reference.hintPath ?? reference.path ?? reference.name,
      aliases: String(getCaseInsensitive(reference.metadata, 'Aliases') ?? 'global').split(/[;,]/).filter(Boolean),
    }));
    let result;
    if (missing.length) result = {success: false, diagnostics: [planError(unit.project,
      'Dependencies did not produce assemblies: ' + missing.join(', '))], metrics: {errors: 1}};
    else {
      const options = {...unit.options, name: unit.assemblyName, references: [...references, ...external]};
      const emission = projectEmissionInputs(unit);
      if (compileUnit) result = compileUnit({...unit, sources: emission.sources}, options, emission.options);
      else {
        const workspace = new Workspace({compilationOptions: options, maxDocuments: 20000, ...extensions});
        for (const file of emission.sources) workspace.update(file.uri ?? file.path, file.text, file.version ?? 1);
        result = compileWorkspace(workspace, 'build', unit.assemblyName, emission.options);
      }
      result.generatedSources = [...(result.generatedSources ?? []), ...emission.generated];
    }
    artifacts.set(contextKey(unit), result);
    diagnostics.push(...result.diagnostics.map(item => ({...item, project: unit.project, contextId: contextKey(unit)})));
    const satellites = result.success ? emitProjectSatellites(unit, result.image) : [];
    units.push({project: unit.project, contextId: contextKey(unit), output: unit.output, assemblyName: unit.assemblyName,
      success: result.success, assembly: result.assembly, pdb: result.pdb, resources: unit.resources,
      satellites, metrics: result.metrics});
  }
  const startup = artifacts.get(plan.startupContextId ?? plan.startup);
  const errors = diagnostics.filter(item => item.severity === 'error').length;
  const metrics = {...startup.metrics, errors, files: plan.units.reduce((sum, unit) => sum + unit.sources.length, 0)};
  return {...startup, success: !errors && units.every(unit => unit.success), diagnostics, metrics, projectArtifacts: units,
    outputLayout: plan.outputLayout, ...(errors ? {image: null, assembly: null, pdb: null} : {})};
}

/** Keystroke analysis retains the shared workspace cache and never emits PE or decodes IL. */
export function createCompilationHandler(workspace) {
  return (params, method) => method === 'build' && params.buildPlan
    ? compileProjectPlan(params.buildPlan, {extensions: {extensions: workspace.extensions,
      extensionOptions: workspace.extensionOptions, additionalFiles: workspace.additionalFiles}})
    : compileWorkspace(workspace, method, params.assemblyName);
}
