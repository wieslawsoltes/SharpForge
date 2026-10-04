import { DragServices } from '@sharpforge/winui-controls';

/** Browser file handles stay outside the VM; only authorized descriptors enter its typed StorageFile projection. */
export function createManagedDragServices(context, options = {}) {
  return context.state(null, 'dragService', () => new DragServices(context, {
    send: command => context.platform.command(command),
    readFiles: options.readFiles ?? (context.services.uiHostRequest
      ? (token, request) => context.services.uiHostRequest('dropFiles', { token }, request) : undefined),
    ...options
  }));
}
