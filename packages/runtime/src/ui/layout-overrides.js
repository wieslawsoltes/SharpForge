import { size, MeasureProvider } from '@sharpforge/winui-controls';
import { ManagedFault } from '../heap.js';
import { layoutReference } from './layout-scene.js';
import { resolveManagedUIMethod } from './virtual-methods.js';

export const layoutSize = value => size(value?.width ?? value?.Width ?? 0, value?.height ?? value?.Height ?? 0);
export const managedLayoutSize = value => ({ valueType: 'Windows.Foundation.Size', Width: value.width, Height: value.height });

/** Text is measured by an injected real metrics provider; fixed-size leaves need no font service. */
export function createManagedMeasureProvider(context, options, resolve) {
  const supplied = options.measureProvider ?? context.services.measureProvider ?? context.platform.options.uiMeasureProvider;
  if (supplied) {
    if (typeof supplied.measure !== 'function') throw new ManagedFault('ArgumentException', 'Layout MeasureProvider requires measure(node, available)');
    return supplied;
  }
  const provider = new MeasureProvider({ resolve, textScale: context.services.environment?.TextScaleFactor ?? 1, measureText: (text, font) => {
    if (!text) return { width: 0 };
    const measure = options.measureText ?? context.services.text?.measureText;
    if (!measure) throw new ManagedFault('NotSupportedException', 'SFLAYOUT003: Headless text Measure requires an injected font measurement service');
    return measure(text, font);
  } });
  return { measure(node, available) {
    if (Number.isFinite(node.properties.Width) && Number.isFinite(node.properties.Height)) return size();
    return provider.measure({ ...node, type: node.frameworkType ?? node.type }, available);
  }, dispose: () => provider.dispose(), invalidate: () => provider.invalidate(),
  setTextScaleFactor: value => provider.setTextScaleFactor(value) };
}

/** Register custom overrides once by managed type, resolving the receiver from the active layout context. */
export function registerManagedLayoutOverride(service, type, base) {
  if (service.customTypes.has(type)) return;
  service.customTypes.add(type);
  const callback = (name, layout, dimensions) => {
    const reference = layoutReference(service.context, layout.id);
    const override = resolveManagedUIMethod(service.context, reference, name, 1);
    if (!override) return service.invokeBaseOverride(reference, name, dimensions, base);
    const result = service.context.invokeVirtual(reference, name, [managedLayoutSize(dimensions)]);
    return layoutSize(service.context.native(result));
  };
  service.engine.registry.register(type, { measure: (layout, available) => callback('MeasureOverride', layout, available),
    arrange: (layout, finalSize) => callback('ArrangeOverride', layout, finalSize) });
}
