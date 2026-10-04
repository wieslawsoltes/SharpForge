import { RendererRegistry } from '../registry.js';
import { contentLayout } from './border-viewbox.js';
import { stackPanelLayout } from './stackpanel.js';
import { canvasLayout } from './canvas.js';
import { viewboxLayout } from './border-viewbox.js';

export function createLayoutRegistry(options) {
  const registry = new RendererRegistry(options);
  registry.register('*', contentLayout);
  registry.register('StackPanel', stackPanelLayout);
  registry.register('Canvas', canvasLayout);
  registry.register('Viewbox', viewboxLayout);
  return registry;
}
export * from './geometry.js';
export * from './layout-engine.js';
export * from './framework-element-layout.js';
export * from './custom-layout.js';
export * from './stackpanel.js';
export * from './canvas.js';
export * from './border-viewbox.js';
export * from './annotated-scrollbar.js';
