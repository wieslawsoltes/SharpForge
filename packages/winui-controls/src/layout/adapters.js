import { registerInputAdapters } from '../input/adapters.js';
import { registerEnvironmentAdapters } from './environment-adapters.js';
import { registerScrollAdapters } from './scroll-adapters.js';
import { registerAnnotatedScrollAdapters } from './annotated-adapters.js';

const xaml = 'Microsoft.UI.Xaml.';
const controls = xaml + 'Controls.';
const input = xaml + 'Input.';
const sizeValue = value => ({ valueType: 'Windows.Foundation.Size', Width: value?.width ?? value?.Width ?? 0,
  Height: value?.height ?? value?.Height ?? 0 });

function requireLayout(context) {
  if (!context.services?.layout?.invoke) throw new Error('SFLAYOUT001: This host requires a synchronous layout service');
  return context.services.layout;
}

function registerOperation(registry, owner, name) {
  registry.register({ owner, name }, ({ context, receiver, args, descriptor }) => {
    const values = args.map(value => context.native(value));
    if (['CapturePointer', 'ReleasePointerCapture'].includes(name) && args[0] != null) {
      values[0] = { PointerId: context.native(context.read(args[0], 'PointerId')) };
    }
    const result = requireLayout(context).invoke(receiver, name, values);
    return descriptor.result === 'void' ? undefined : result;
  });
}

/** Shared JS/managed adapters use an explicit synchronous service, with no DOM dependency. */
export function registerLayoutAdapters(registry) {
  for (const name of ['Measure', 'Arrange', 'InvalidateMeasure', 'InvalidateArrange', 'UpdateLayout', 'Focus',
    'CapturePointer', 'ReleasePointerCapture', 'ReleasePointerCaptures']) registerOperation(registry, xaml + 'UIElement', name);
  for (const [property, member] of [['DesiredSize', 'desiredSize'], ['RenderSize', 'renderSize']]) {
    registry.register({ owner: xaml + 'UIElement', name: 'get_' + property, kind: 'get' }, ({ context, receiver }) => {
      const service = requireLayout(context);
      const value = member === 'desiredSize' ? service.getDesiredSize?.(receiver) : service.getRenderSize?.(receiver);
      return sizeValue(value ?? service.getLayout(receiver)?.[member]);
    });
  }
  for (const [property, dimension] of [['ActualWidth', 'width'], ['ActualHeight', 'height']]) {
    registry.register({ owner: xaml + 'FrameworkElement', name: 'get_' + property, kind: 'get' }, ({ context, receiver }) => {
      const service = requireLayout(context);
      return service.getRenderSize?.(receiver)?.[dimension] ?? service.getLayout(receiver)?.renderSize?.[dimension] ?? 0;
    });
  }
  for (const name of ['MeasureOverride', 'ArrangeOverride']) {
    registry.register({ owner: xaml + 'FrameworkElement', name }, ({ context, receiver, args }) => {
      const service = requireLayout(context);
      if (!service.invokeBaseOverride) throw new Error('SFLAYOUT002: Base layout overrides require a managed layout callback service');
      return sizeValue(service.invokeBaseOverride(receiver, name, context.native(args[0])));
    });
  }
  for (const name of ['GetFocusedElement', 'TryMoveFocus', 'FindNextElement']) registerOperation(registry, input + 'FocusManager', name);
  registerScrollAdapters(registry);
  registerAnnotatedScrollAdapters(registry);
  for (const name of ['TryGetElement', 'GetElementIndex']) registerOperation(registry, controls + 'ItemsRepeater', name);
  registerInputAdapters(registry);
  registerEnvironmentAdapters(registry);
}
