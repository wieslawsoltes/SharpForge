import { frameworkType } from '@sharpforge/framework';
import * as controls from '@sharpforge/winui-controls';
import { RenderSurface, cssColor, parseColor, drawingPrimitives } from './surface.js';

/** Compatibility facade composes package contracts without introducing a framework/controls dependency cycle. */
export class WinUIHost extends controls.RetainedWinUIHost {
  constructor(root, options = {}) {
    const registry = options.registry ?? new controls.RendererRegistry({ resolveType: frameworkType });
    if (!options.registry) {
      controls.registerLegacyRenderers(registry);
      controls.registerControlFamilies?.(registry);
    }
    super(root, { ...options, registry, frameworkType,
      drawing: { RenderSurface, cssColor, parseColor, drawingPrimitives } });
  }
}
