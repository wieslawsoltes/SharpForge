import {readProjectGraph} from './load/project-graph-inputs.js';
import {bindProjectGraph} from './load/project-graph-bindings.js';
import {linkProjectImage} from './load/project-graph-linker.js';
import {projectGraphDebug} from './load/project-graph-debug.js';

export {projectReferenceDiagnostics} from './load/project-reference-errors.js';

/**
 * Load a closed set of canonical SharpForge PEs by full identity and SHA-256.
 * dependencies accepts {assembly, project?, contextId?} records. No path or network resolution occurs.
 * Returns an independent linked source image, original canonical modules and entryKey; supports libraries.
 * Invalid input, unresolved definitions, bounded graph overflow and cancellation throw coded CilError.
 */
export function loadProjectAssembly(assembly, options = {}) {
  const started = performance.now();
  const graph = bindProjectGraph(readProjectGraph(assembly, options), options);
  const image = linkProjectImage(graph, options);
  const modules = graph.modules.map(module => ({key: module.key, identity: module.identity, sha256: module.sha256,
    bytes: module.bytes, image: module.image, inspector: module.inspector, dependencies: module.dependencies,
    resources: module.resources, assemblyAttributes: module.assemblyAttributes,
    sourceUris: module.sourceUris,
    references: module.references, ...(module.project === undefined ? {} : {project: module.project}),
    ...(module.contextId === undefined ? {} : {contextId: module.contextId})}));
  image.il = {format: 'ECMA-335', profile: 'SharpForge.ProjectGraph/1',
    ...projectGraphDebug(image, graph.modules),
    assemblyBytes: modules.reduce((sum, module) => sum + module.bytes.length, 0),
    decodeMs: modules.reduce((sum, module) => sum + module.image.il.decodeMs, 0),
    verificationMs: modules.reduce((sum, module) => sum + module.image.il.verificationMs, 0),
    loadMs: performance.now() - started, modules: modules.map(module => ({key: module.key, sha256: module.sha256}))};
  return {image, modules, entryKey: graph.entryKey};
}
