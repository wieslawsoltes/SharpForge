import { annotatedControllerType } from '../contracts/annotated-scrollbar.js';
import { AnnotatedScrollController } from './annotated-scrollbar.js';
import { modernScrollTypes } from '../contracts/scrolling.js';

const C = 'Microsoft.UI.Xaml.Controls.', P = C + 'Primitives.';
const barFields = ['Minimum', 'Maximum', 'Value', 'ViewportSize', 'IsScrollingWithMouse', 'IsScrollable'];

function owner(context, controller) {
  const value = context.read(controller, 'Owner');
  if (!value) throw new Error('SFUI1676: Scroll controller has no owning annotated scrollbar');
  return value;
}
function read(context, target, property, fallback = 0) {
  return context.native(context.read(target, property)) ?? fallback;
}
function controllerReference(context, receiver) {
  let reference = context.read(receiver, 'ScrollController');
  if (!reference) {
    reference = context.allocate(annotatedControllerType, { Owner: receiver });
    context.write(receiver, 'ScrollController', reference);
  }
  return reference;
}

/** Browser controller feedback only updates a declared bounded set of range/interaction fields. */
export function observeLayoutControlEvent(context, receiver, event, payload) {
  if (event !== 'ControllerStateChanged' || context.typeOf(receiver) !== C + 'AnnotatedScrollBar') return false;
  for (const property of barFields) {
    const value = payload[property];
    if (value == null) continue;
    if (property.startsWith('Is') ? typeof value !== 'boolean' : !Number.isFinite(value) || Math.abs(value) > 1e9) {
      throw new TypeError('SFUI1676: Invalid controller feedback');
    }
    context.write(receiver, property, value);
  }
  return true;
}

export function registerAnnotatedScrollAdapters(registry) {
  const bar = C + 'AnnotatedScrollBar', controller = P + 'IScrollController';
  const registerController = (specification, callback) => {
    registry.register({ ...specification, owner: controller }, callback);
    registry.register({ ...specification, owner: annotatedControllerType }, callback);
  };
  registry.register({ owner: bar, name: 'get_ScrollController', kind: 'get' }, ({ context, receiver }) => controllerReference(context, receiver));
  registry.register({ owner: C + 'ScrollView', name: 'get_ScrollPresenter', kind: 'get' }, ({ context, receiver }) =>
    context.state(receiver, 'templateHost')?.getTemplateChild('PART_ScrollPresenter') ?? null);
  registry.register({ owner: C + 'AnnotatedScrollBarLabel', name: '.ctor', kind: 'constructor' }, ({ context, receiver, args }) => {
    const offset = context.native(args[1]);
    if (!Number.isFinite(offset) || Math.abs(offset) > 1e9) throw new RangeError('SFUI1676: Invalid annotated label offset');
    const values = { Content: args[0], ScrollOffset: offset };
    if (!receiver) return context.allocate(C + 'AnnotatedScrollBarLabel', values);
    for (const [name, value] of Object.entries(values)) context.write(receiver, name, value);
    return receiver;
  });
  registerController({ name: 'get_CanScroll', kind: 'get' }, ({ context, receiver }) => {
    const target = owner(context, receiver);
    return read(context, target, 'IsScrollable', true) && read(context, target, 'Maximum') > read(context, target, 'Minimum');
  });
  registerController({ name: 'get_IsScrollingWithMouse', kind: 'get' }, ({ context, receiver }) =>
    read(context, owner(context, receiver), 'IsScrollingWithMouse', false));
  registerController({ name: 'get_PanningInfo', kind: 'get' }, () => null);
  registerController({ name: 'SetValues' }, ({ context, receiver, args }) => {
    const values = args.map(value => context.native(value)), range = new AnnotatedScrollController();
    range.setValues(...values);
    values[2] = range.offset;
    const target = owner(context, receiver);
    for (const [index, name] of ['Minimum', 'Maximum', 'Value', 'ViewportSize'].entries()) context.write(target, name, values[index]);
  });
  registerController({ name: 'SetIsScrollable' }, ({ context, receiver, args }) =>
    context.write(owner(context, receiver), 'IsScrollable', !!context.native(args[0])));
  registerController({ name: 'GetScrollAnimation' }, ({ args }) => args[3]);
  registerController({ name: 'NotifyRequestedScrollCompleted' }, ({ context, receiver, args }) => {
    const target = owner(context, receiver);
    context.services.layout.invoke(target, 'CompleteControllerScroll', [context.native(args[0])]);
  });
  for (const source of modernScrollTypes) for (const axis of ['Horizontal', 'Vertical']) {
    registry.register({ owner: source, name: 'set_' + axis + 'ScrollController', kind: 'set' }, ({ context, receiver, args }) => {
      const value = args[0];
      if (value && context.typeOf(value) !== annotatedControllerType && !context.services.scrollControllers?.accept?.(value)) {
        throw new Error('SFUI1676: Custom IScrollController requires an explicit controller adapter');
      }
      if (value) {
        context.write(value, 'Source', receiver);
        context.write(value, 'Axis', axis === 'Horizontal' ? 0 : 1);
      }
      context.write(receiver, axis + 'ScrollController', value);
    });
  }
}
