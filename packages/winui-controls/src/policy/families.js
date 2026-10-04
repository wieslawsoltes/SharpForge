import { registerItemsRenderers } from '../items/index.js';
import { registerTextRenderers } from '../text/index.js';
import { registerButtonRenderers } from '../buttons/index.js';
import { registerNavigationRenderers } from '../navigation/index.js';
import { registerOverlayRenderers } from '../overlay/index.js';
import { registerValueRenderers } from '../values/index.js';
import { registerCommandsRenderers } from '../commands/index.js';
import { registerMediaRenderers } from '../media/index.js';
import { registerIconRenderers } from '../icons/index.js';

export * from './default-templates.js';

/** Register after legacy renderer extraction so explicit family implementations take precedence. */
export function registerControlFamilies(registry) {
  for (const register of [registerItemsRenderers, registerTextRenderers, registerButtonRenderers,
    registerNavigationRenderers, registerOverlayRenderers, registerValueRenderers,
    registerCommandsRenderers, registerMediaRenderers, registerIconRenderers]) register(registry);
  return registry;
}
