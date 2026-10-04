import { createNativeVfsService } from './native-vfs.js';

/** Register the granted-workspace byte provider through the native service contribution boundary. */
export function registerNativeVfsServices(registry, { workspace }) {
  const invoke = createNativeVfsService(workspace);
  registry.register('vfs', 'request', (request, options) => invoke(request.method, request.payload, options));
}
