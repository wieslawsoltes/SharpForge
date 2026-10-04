import { registerNativeVfsServices } from './services-vfs.js';
import { NativeServiceRegistry } from './service-registry.js';
import { registerNativeSdkServices } from './services-sdk.js';
import { registerNativeProjectServices } from './services-project.js';
import { registerNativeNuGetServices } from './services-nuget.js';
import { registerNativePublishServices } from './services-publish.js';
import { registerNativeBinlogServices } from './services-binlog.js';
import { registerNativeTestingServices } from './testing/native-adapter.js';

export { NativeServiceRegistry } from './service-registry.js';

/** Compose native feature contributions without coupling their implementation modules. */
export function createNativeServices(engine, options = {}) {
  const registry = new NativeServiceRegistry();
  const context = { engine, workspace: engine.workspace };
  registerNativeVfsServices(registry, context);
  registerNativeTestingServices(registry, context);
  registerNativeProjectServices(registry, context);
  const { discover } = registerNativeSdkServices(registry, context);
  registerNativeNuGetServices(registry, context, options);
  registerNativePublishServices(registry, context);
  const { binlog } = registerNativeBinlogServices(registry, context);
  for (const contribution of options.contributions ?? []) contribution(registry, context);
  return { registry, discover, binlog };
}

export { registerNativeSdkServices } from './services-sdk.js';
export { registerNativeProjectServices } from './services-project.js';
export { registerNativeNuGetServices } from './services-nuget.js';
export { registerNativePublishServices } from './services-publish.js';
export { registerNativeBinlogServices } from './services-binlog.js';
export { registerNativeVfsServices } from './services-vfs.js';
