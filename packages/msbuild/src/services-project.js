import { runNativeProject } from './launch.js';
import { DesignTimeBuildService } from './design-time.js';
import { NativeBuildService } from './build-service.js';
import { NativeProjectGraphService } from './native-project-graph.js';
import { NativeMetadataReferenceService } from './native-metadata.js';

/** Register the semantic contexts, native builds, dependency graph and launch services. */
export function registerNativeProjectServices(registry, { engine }) {
  const designTime = new DesignTimeBuildService(engine), build = new NativeBuildService(engine);
  const graph = new NativeProjectGraphService(engine, designTime);
  const metadata = new NativeMetadataReferenceService(designTime);
  registry.disposables.push(designTime);
  registry.disposables.push(graph);
  registry.register('project', 'context', (request, options) => designTime.context(request, options));
  registry.register('project', 'contexts', (request, options) => designTime.contexts(request, options));
  registry.register('project', 'metadata', (request, options) => metadata.read(request, options));
  registry.register('project', 'run', (request, options) => runNativeProject(engine, request, options));
  registry.register('build', 'execute', (request, options) => build.build(request, options));
  registry.register('build', 'graph', (request, options) => graph.inspect(request, options));
  registry.register('build', 'affected', (request, options) => graph.build(request, options));
}
