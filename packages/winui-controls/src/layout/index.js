import { RendererRegistry } from '../registry.js';
import { contentLayout } from './border-viewbox.js';
import { viewboxLayout } from './border-viewbox.js';

export function createLayoutRegistry(options) {
  const registry = new RendererRegistry(options);
  registry.register('*', contentLayout);
  registry.register('Viewbox', viewboxLayout);
  return registry;
}
export * from './geometry.js';
export * from './framework-element-layout.js';
export * from './border-viewbox.js';
