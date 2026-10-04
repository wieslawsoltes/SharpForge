import { registerNativePublishServices } from './services-publish.js';
import { registerNativeProjectServices } from './services-project.js';
import { registerNativeVfsServices } from './services-vfs.js';
import { NativeServiceRegistry } from './service-registry.js';
import { registerNativeSdkServices } from './services-sdk.js';

export { NativeServiceRegistry } from './service-registry.js';

/** Compose SDK inspection and explicitly supplied native feature contributions. */
export function createNativeServices(engine, options = {}) {
  const registry = new NativeServiceRegistry();
  const context = { engine, workspace: engine.workspace };
  registerNativeVfsServices(registry, context);
  registerNativeProjectServices(registry, context);
  registerNativePublishServices(registry, context);
  const { discover } = registerNativeSdkServices(registry, context);
  for (const contribution of options.contributions ?? []) contribution(registry, context);
  return { registry, discover };
}

export { registerNativeVfsServices } from './services-vfs.js';

export { registerNativeProjectServices } from './services-project.js';

export { registerNativePublishServices } from './services-publish.js';
