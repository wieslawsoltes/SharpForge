import { registerCommandRenderers } from './menu-renderer.js';
import { registerGestureRenderers } from './swipe-refresh.js';
import { registerTextCommandFlyout } from './text-flyout.js';

export { XamlUICommand, StandardUICommand, commandCanExecute, executeCommand } from './command.js';
export { KeyboardAcceleratorRouter, AcceleratorModifiers } from './accelerators.js';
export { RefreshController } from './swipe-refresh.js';
export { partitionCommandBar, commandBarGeometry } from './geometry.js';
export { registerCommandLayouts } from './layout.js';
export { registerMenuLayouts } from './menu-layout.js';
export { TextCommandController, textCommandLabels } from './text-command.js';

export function registerCommandsRenderers(registry) {
  registerCommandRenderers(registry);
  registerGestureRenderers(registry);
  registerTextCommandFlyout(registry);
}
