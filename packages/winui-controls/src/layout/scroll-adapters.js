import { modernScrollTypes, snapPointConstructorFields } from '../contracts/scrolling.js';
import { normalizeScrollOptions, normalizeSnapPoint } from './scroll-options.js';

const C = 'Microsoft.UI.Xaml.Controls.';
const metrics = ['ExtentWidth', 'ExtentHeight', 'ViewportWidth', 'ViewportHeight', 'HorizontalOffset', 'VerticalOffset',
  'ScrollableWidth', 'ScrollableHeight', 'ZoomFactor'];

function service(context) {
  if (!context.services.layout?.invoke) throw new Error('SFLAYOUT001: Scrolling requires the layout service');
  return context.services.layout;
}
function options(context, reference) {
  if (reference == null) return {};
  return normalizeScrollOptions({ AnimationMode: context.native(context.read(reference, 'AnimationMode')),
    SnapPointsMode: context.native(context.read(reference, 'SnapPointsMode')) });
}

export function registerScrollAdapters(registry) {
  for (const owner of [C + 'ScrollViewer', ...modernScrollTypes]) {
    const names = owner === C + 'ScrollViewer' ? ['ChangeView'] : ['ScrollTo', 'ScrollBy', 'ZoomTo'];
    for (const name of names) registry.register({ owner, name }, ({ context, receiver, args }) => {
      const values = args.map(value => context.native(value));
      if (name !== 'ChangeView' && args.length > 2) values[2] = options(context, args[2]);
      return service(context).invoke(receiver, name, values);
    });
    for (const property of metrics) registry.register({ owner, name: 'get_' + property, kind: 'get' }, ({ context, receiver }) => {
      const layout = service(context);
      const values = layout.getScrollMetrics ? layout.getScrollMetrics(receiver) : layout.invoke(receiver, 'GetScrollMetrics', []);
      return values?.[property] ?? context.native(context.read(receiver, property)) ?? 0;
    });
    for (const name of ['RegisterAnchorCandidate', 'UnregisterAnchorCandidate']) registry.register({ owner, name },
      ({ context, receiver, args }) => service(context).invoke(receiver, name, [context.id(args[0])]));
    registry.register({ owner, name: 'get_CurrentAnchor', kind: 'get' }, ({ context, receiver }) => {
      const id = service(context).invoke(receiver, 'GetCurrentAnchor', []);
      return id == null ? null : context.reference(id);
    });
  }
  for (const owner of [C + 'ScrollingScrollOptions', C + 'ScrollingZoomOptions']) {
    registry.register({ owner, name: '.ctor', kind: 'constructor' }, ({ context, receiver, args }) => {
      const values = normalizeScrollOptions({ AnimationMode: context.native(args[0]), SnapPointsMode: context.native(args[1]) });
      const properties = { AnimationMode: values.animationMode, SnapPointsMode: values.snapPointsMode };
      if (!receiver) return context.allocate(owner, properties);
      for (const [name, value] of Object.entries(properties)) context.write(receiver, name, value);
      return receiver;
    });
    for (const property of ['AnimationMode', 'SnapPointsMode']) registry.register({ owner, name: 'set_' + property, kind: 'set' },
      ({ context, receiver, args }) => {
        const values = { AnimationMode: context.native(context.read(receiver, 'AnimationMode')),
          SnapPointsMode: context.native(context.read(receiver, 'SnapPointsMode')), [property]: context.native(args[0]) };
        normalizeScrollOptions(values);
        context.write(receiver, property, values[property]);
      });
  }
  for (const [owner, fields] of Object.entries(snapPointConstructorFields)) registry.register({ owner, name: '.ctor', kind: 'constructor' },
    ({ context, receiver, args }) => {
      const properties = Object.fromEntries(fields.map((name, index) => [name, context.native(args[index])]));
      normalizeSnapPoint(properties);
      if (!receiver) return context.allocate(owner, properties);
      for (const [name, value] of Object.entries(properties)) context.write(receiver, name, value);
      return receiver;
    });
}
