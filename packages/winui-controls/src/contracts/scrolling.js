import { addType, addProperty, addMethod, addEvent } from './contract-registration.js';
import { ScrollingAnimationMode, ScrollingSnapPointsMode, ScrollSnapPointsAlignment,
  ScrollingContentOrientation } from '../layout/scroll-options.js';

const C = 'Microsoft.UI.Xaml.Controls.', P = C + 'Primitives.', X = 'Microsoft.UI.Xaml.';
export const modernScrollTypes = Object.freeze([C + 'ScrollView', C + 'ScrollPresenter', P + 'ScrollPresenter']);
export const snapPointConstructorFields = Object.freeze({
  [P + 'ScrollSnapPoint']: ['Value', 'Alignment'], [P + 'RepeatedScrollSnapPoint']: ['Offset', 'Interval', 'Start', 'End', 'Alignment'],
  [P + 'ZoomSnapPoint']: ['Value'], [P + 'RepeatedZoomSnapPoint']: ['Offset', 'Interval', 'Start', 'End'] });

function collection(registry, element) {
  const type = 'System.Collections.Generic.IList`1<' + element + '>';
  addType(registry, type, { kind: 'collection', element, elementType: element });
  addProperty(registry, type, 'Count', 'int', 0, true);
  for (const [name, parameters, result] of [['Add', [element], 'void'], ['Insert', ['int', element], 'void'],
    ['Remove', [element], 'bool'], ['RemoveAt', ['int'], 'void'], ['Clear', [], 'void'], ['get_Item', ['int'], element]]) {
    addMethod(registry, type, name, parameters, result);
  }
  return type;
}
function event(registry, owner, name, argument) {
  const delegate = 'Windows.Foundation.TypedEventHandler`2<' + owner + ',' + argument + '>';
  if (!registry.types.has(delegate)) registry.delegate(delegate, [owner, argument]);
  addEvent(registry, owner, name, delegate);
}

/** Native option/snap-point projections extend the previously released scrolling signatures. */
export function registerScrollingContracts(registry) {
  for (const [name, values] of [[C + 'ScrollingAnimationMode', ScrollingAnimationMode], [C + 'ScrollingSnapPointsMode', ScrollingSnapPointsMode],
    [P + 'ScrollSnapPointsAlignment', ScrollSnapPointsAlignment], [C + 'ScrollingContentOrientation', ScrollingContentOrientation]]) {
    if (!registry.types.has(name)) registry.en(name, values);
  }
  for (const name of ['ScrollingScrollOptions', 'ScrollingZoomOptions']) {
    addType(registry, C + name, { kind: 'object' }, [[C + 'ScrollingAnimationMode'], [C + 'ScrollingAnimationMode', C + 'ScrollingSnapPointsMode']]);
    addProperty(registry, C + name, 'AnimationMode', C + 'ScrollingAnimationMode', 2);
    addProperty(registry, C + name, 'SnapPointsMode', C + 'ScrollingSnapPointsMode', 0);
  }
  for (const [name, base] of [['SnapPointBase', 'object'], ['ScrollSnapPointBase', P + 'SnapPointBase'],
    ['ZoomSnapPointBase', P + 'SnapPointBase']]) addType(registry, P + name, { kind: 'abstract', base }, []);
  addProperty(registry, P + 'ScrollSnapPointBase', 'Alignment', P + 'ScrollSnapPointsAlignment', 0, true);
  for (const [owner, fields] of Object.entries(snapPointConstructorFields)) {
    const base = P + (owner.includes('ScrollSnap') ? 'ScrollSnapPointBase' : 'ZoomSnapPointBase');
    addType(registry, owner, { kind: 'object', base }, [fields.map(name => name === 'Alignment' ? P + 'ScrollSnapPointsAlignment' : 'double')]);
    for (const name of fields) if (name !== 'Alignment') addProperty(registry, owner, name, 'double', 0, true);
  }
  const scrollPoints = collection(registry, P + 'ScrollSnapPointBase'), zoomPoints = collection(registry, P + 'ZoomSnapPointBase');
  addType(registry, P + 'ScrollPresenter', { kind: 'control', base: X + 'FrameworkElement', contentProperty: 'Content' });
  addProperty(registry, P + 'ScrollPresenter', 'Content', X + 'UIElement');
  for (const type of modernScrollTypes) {
    for (const name of ['HorizontalSnapPoints', 'VerticalSnapPoints']) addProperty(registry, type, name, scrollPoints, null, true);
    addProperty(registry, type, 'ZoomSnapPoints', zoomPoints, null, true);
    addProperty(registry, type, 'ContentOrientation', C + 'ScrollingContentOrientation', 0);
    for (const name of ['ScrollTo', 'ScrollBy']) {
      addMethod(registry, type, name, ['double', 'double'], 'int');
      addMethod(registry, type, name, ['double', 'double', C + 'ScrollingScrollOptions'], 'int');
    }
    for (const args of [['float', 'System.Numerics.Vector2?'], ['float', 'System.Numerics.Vector2?', C + 'ScrollingZoomOptions']]) {
      addMethod(registry, type, 'ZoomTo', args, 'int');
    }
    for (const property of ['ExtentWidth', 'ExtentHeight', 'ViewportWidth', 'ViewportHeight', 'HorizontalOffset', 'VerticalOffset']) {
      addProperty(registry, type, property, 'double', 0, true);
    }
    addProperty(registry, type, 'ZoomFactor', 'double', 1, true);
    for (const [name, value] of [['MinZoomFactor', 0.1], ['MaxZoomFactor', 10]]) addProperty(registry, type, name, 'double', value);
    for (const axis of ['Horizontal', 'Vertical']) addProperty(registry, type, axis + 'ScrollMode', C + 'ScrollMode', 1);
    addProperty(registry, type, 'ZoomMode', C + 'ZoomMode', 0);
    event(registry, type, 'ViewChanged', 'object');
    for (const kind of ['Scroll', 'Zoom']) {
      const argument = C + 'Scrolling' + kind + 'CompletedEventArgs';
      addType(registry, argument, { kind: 'object' }, []);
      addProperty(registry, argument, 'CorrelationId', 'int', 0, true);
      event(registry, type, kind + 'Completed', argument);
    }
  }
  for (const type of [C + 'ScrollViewer', ...modernScrollTypes]) {
    for (const axis of ['Horizontal', 'Vertical']) addProperty(registry, type, axis + 'AnchorRatio', 'double', 0);
    addProperty(registry, type, 'CurrentAnchor', X + 'UIElement', null, true);
    for (const name of ['RegisterAnchorCandidate', 'UnregisterAnchorCandidate']) addMethod(registry, type, name, [X + 'UIElement']);
  }
  addProperty(registry, X + 'UIElement', 'CanBeScrollAnchor', 'bool', false);
}
