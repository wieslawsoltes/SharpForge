import { NativeServiceRegistry } from './service-registry.js';
import { registerNativeSdkServices } from './services-sdk.js';

export { NativeServiceRegistry } from './service-registry.js';

/** Compose SDK inspection and explicitly supplied native feature contributions. */
export function createNativeServices(engine, options = {}) {
  const registry = new NativeServiceRegistry();
  const context = { engine, workspace: engine.workspace };
  const { discover } = registerNativeSdkServices(registry, context);
  for (const contribution of options.contributions ?? []) contribution(registry, context);
  return { registry, discover };
}
