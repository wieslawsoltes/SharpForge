import { addType, addProperty, addMethod, addEvent } from './contract-registration.js';
import { modernScrollTypes } from './scrolling.js';
import { AnnotatedScrollBarScrollingEventKind } from '../layout/annotated-scrollbar.js';

const C = 'Microsoft.UI.Xaml.Controls.', P = C + 'Primitives.', X = 'Microsoft.UI.Xaml.';
export const annotatedControllerType = 'SharpForge.UI.AnnotatedScrollController';

function typedEvent(registry, owner, name, argument) {
  const delegate = 'Windows.Foundation.TypedEventHandler`2<' + owner + ',' + argument + '>';
  if (!registry.types.has(delegate)) registry.delegate(delegate, [owner, argument]);
  addEvent(registry, owner, name, delegate);
}

/** Annotated labels and the native controller connection are additive to the released range-shaped profile. */
export function registerAnnotatedScrollContracts(registry) {
  const bar = C + 'AnnotatedScrollBar', label = C + 'AnnotatedScrollBarLabel', controller = P + 'IScrollController';
  addType(registry, label, { kind: 'object' }, [['object', 'double']]);
  addProperty(registry, label, 'Content', 'object', null, true);
  addProperty(registry, label, 'ScrollOffset', 'double', 0, true);
  const labels = 'System.Collections.Generic.IList`1<' + label + '>';
  addType(registry, labels, { kind: 'collection', element: label, elementType: label });
  addProperty(registry, labels, 'Count', 'int', 0, true);
  for (const [name, parameters, result] of [['Add', [label], 'void'], ['Insert', ['int', label], 'void'],
    ['Remove', [label], 'bool'], ['RemoveAt', ['int'], 'void'], ['Clear', [], 'void'], ['get_Item', ['int'], label]]) {
    addMethod(registry, labels, name, parameters, result);
  }
  addProperty(registry, bar, 'Labels', labels);
  addProperty(registry, bar, 'SmallChange', 'double', 16);
  for (const name of ['LabelTemplate', 'DetailLabelTemplate']) addProperty(registry, bar, name, 'object');
  addType(registry, P + 'IScrollControllerPanningInfo', { kind: 'interface' }, []);
  addType(registry, controller, { kind: 'interface' }, []);
  addType(registry, annotatedControllerType, { kind: 'object', interfaces: [controller] }, []);
  addProperty(registry, annotatedControllerType, 'Owner', bar, null, true);
  addProperty(registry, annotatedControllerType, 'Source', X + 'UIElement');
  addProperty(registry, annotatedControllerType, 'Axis', 'int', 1);
  addProperty(registry, bar, 'ScrollController', controller, null, true);
  addProperty(registry, bar, 'IsScrollingWithMouse', 'bool', false, true);
  addProperty(registry, bar, 'IsScrollable', 'bool', true);
  for (const property of ['CanScroll', 'IsScrollingWithMouse']) addProperty(registry, controller, property, 'bool', false, true);
  addProperty(registry, controller, 'PanningInfo', P + 'IScrollControllerPanningInfo', null, true);
  addMethod(registry, controller, 'SetValues', ['double', 'double', 'double', 'double']);
  addMethod(registry, controller, 'SetIsScrollable', ['bool']);
  addMethod(registry, controller, 'NotifyRequestedScrollCompleted', ['int']);
  addMethod(registry, controller, 'GetScrollAnimation', ['int', 'System.Numerics.Vector2', 'System.Numerics.Vector2',
    'Microsoft.UI.Composition.CompositionAnimation'], 'Microsoft.UI.Composition.CompositionAnimation');
  for (const name of ['CanScrollChanged', 'IsScrollingWithMouseChanged']) typedEvent(registry, controller, name, 'object');
  for (const kind of ['ScrollTo', 'ScrollBy', 'AddScrollVelocity']) {
    const argument = P + 'ScrollController' + kind + 'RequestedEventArgs';
    addType(registry, argument, { kind: 'object' }, []);
    addProperty(registry, argument, 'CorrelationId', 'int', -1);
    if (kind === 'AddScrollVelocity') {
      addProperty(registry, argument, 'OffsetVelocity', 'float', 0, true);
      addProperty(registry, argument, 'InertiaDecayRate', 'float?', null, true);
    } else {
      addProperty(registry, argument, kind === 'ScrollTo' ? 'Offset' : 'OffsetDelta', 'double', 0, true);
      addProperty(registry, argument, 'Options', C + 'ScrollingScrollOptions', null, true);
    }
    typedEvent(registry, controller, kind + 'Requested', argument);
  }
  for (const [name, property] of Object.entries(registry.types.get(controller).properties)) {
    addProperty(registry, annotatedControllerType, name, property.type, property.value, property.readOnly);
  }
  for (const name of ['SetValues', 'SetIsScrollable', 'NotifyRequestedScrollCompleted', 'GetScrollAnimation']) {
    for (const member of registry.memberIndex.get(controller + '::' + name) ?? []) {
      addMethod(registry, annotatedControllerType, name, member.parameters, member.result);
    }
  }
  for (const [name, delegate] of Object.entries(registry.types.get(controller).events)) addEvent(registry, annotatedControllerType, name, delegate);
  if (!registry.types.has(C + 'AnnotatedScrollBarScrollingEventKind')) {
    registry.en(C + 'AnnotatedScrollBarScrollingEventKind', AnnotatedScrollBarScrollingEventKind);
  }
  for (const name of ['Scrolling', 'DetailLabelRequested']) {
    const argument = C + 'AnnotatedScrollBar' + name + 'EventArgs';
    addType(registry, argument, { kind: 'object' }, []);
    addProperty(registry, argument, 'ScrollOffset', 'double', 0, true);
    if (name === 'Scrolling') {
      addProperty(registry, argument, 'ScrollingEventKind', C + 'AnnotatedScrollBarScrollingEventKind', 0, true);
      addProperty(registry, argument, 'Cancel', 'bool', false);
    } else addProperty(registry, argument, 'Content', 'object');
    typedEvent(registry, bar, name, argument);
  }
  addEvent(registry, bar, 'ControllerStateChanged');
  for (const owner of modernScrollTypes) for (const axis of ['Horizontal', 'Vertical']) {
    addProperty(registry, owner, axis + 'ScrollController', controller);
  }
  addProperty(registry, C + 'ScrollView', 'ScrollPresenter', P + 'ScrollPresenter', null, true);
}
