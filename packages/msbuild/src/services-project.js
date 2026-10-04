import { DesignTimeBuildService } from './design-time.js';
import { NativeMetadataReferenceService } from './native-metadata.js';

/** Register authoritative project contexts and their bounded assembly metadata inputs. */
export function registerNativeProjectServices(registry, { engine }) {
  const designTime = new DesignTimeBuildService(engine);
  const metadata = new NativeMetadataReferenceService(designTime);
  registry.disposables.push(designTime);
  registry.register('project', 'context', (request, options) => designTime.context(request, options));
  registry.register('project', 'contexts', (request, options) => designTime.contexts(request, options));
  registry.register('project', 'metadata', (request, options) => metadata.read(request, options));
}
