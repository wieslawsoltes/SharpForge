import { NativeBuildService } from './build-service.js';
import { NativeProjectGraphService } from './native-project-graph.js';
import { DesignTimeBuildService } from './design-time.js';
import { NativeMetadataReferenceService } from './native-metadata.js';

/** Register authoritative project contexts and their bounded assembly metadata inputs. */
export function registerNativeProjectServices(registry, { engine }) {
  const designTime = new DesignTimeBuildService(engine);
  const build = new NativeBuildService(engine);
  const graph = new NativeProjectGraphService(engine, designTime);
  const metadata = new NativeMetadataReferenceService(designTime);
  registry.disposables.push(designTime, graph);
  registry.register('project', 'context', (request, options) => designTime.context(request, options));
  registry.register('project', 'contexts', (request, options) => designTime.contexts(request, options));
  registry.register('project', 'metadata', (request, options) => metadata.read(request, options));
  registry.register('build', 'execute', (request, options) => build.build(request, options));
  registry.register('build', 'graph', (request, options) => graph.inspect(request, options));
  registry.register('build', 'affected', (request, options) => graph.build(request, options));
}
