import { addType, addProperty, addMethod } from './contract-registration.js';

export const pointerPointType = 'Microsoft.UI.Input.PointerPoint';
export const pointerPointListType = 'System.Collections.Generic.IList`1<' + pointerPointType + '>';
export const pointerPointCollectionType = 'System.Collections.Generic.ICollection`1<' + pointerPointType + '>';
export const pointerPointEnumerableType = 'System.Collections.Generic.IEnumerable`1<' + pointerPointType + '>';
export const pointerPointEnumeratorType = 'System.Collections.Generic.IEnumerator`1<' + pointerPointType + '>';

export const inputArgumentTypes = Object.freeze({
  Tapped: 'TappedRoutedEventArgs', DoubleTapped: 'DoubleTappedRoutedEventArgs', RightTapped: 'RightTappedRoutedEventArgs',
  Holding: 'HoldingRoutedEventArgs', CharacterReceived: 'CharacterReceivedRoutedEventArgs',
  ManipulationStarting: 'ManipulationStartingRoutedEventArgs', ManipulationStarted: 'ManipulationStartedRoutedEventArgs',
  ManipulationDelta: 'ManipulationDeltaRoutedEventArgs', ManipulationInertiaStarting: 'ManipulationInertiaStartingRoutedEventArgs',
  ManipulationCompleted: 'ManipulationCompletedRoutedEventArgs'
});

export function registerInputPayloadContracts(registry) {
  const input = registry.XAML + 'Input.';
  const uiInput = 'Microsoft.UI.Input.';
  if (!registry.types.has(uiInput + 'PointerDeviceType')) registry.en(uiInput + 'PointerDeviceType', { Touch: 0, Pen: 1, Mouse: 2, Touchpad: 3 });
  if (!registry.types.has('Windows.Devices.Input.PointerDeviceType')) {
    registry.en('Windows.Devices.Input.PointerDeviceType', { Touch: 0, Pen: 1, Mouse: 2, Touchpad: 3 });
  }
  addProperty(registry, input + 'Pointer', 'PointerDeviceType', uiInput + 'PointerDeviceType', 2, true);
  addProperty(registry, input + 'Pointer', 'IsInRange', 'bool', false, true);
  for (const [name, type, value] of [['PointerDeviceType', uiInput + 'PointerDeviceType', 2], ['Timestamp', 'ulong', 0],
    ['FrameId', 'uint', 0], ['IsInContact', 'bool', false]]) addProperty(registry, pointerPointType, name, type, value, true);
  const properties = uiInput + 'PointerPointProperties';
  for (const name of ['IsXButton1Pressed', 'IsXButton2Pressed', 'IsBarrelButtonPressed', 'IsCanceled', 'IsInRange', 'IsInverted',
    'TouchConfidence', 'IsHorizontalMouseWheel']) addProperty(registry, properties, name, 'bool', false, true);
  addProperty(registry, properties, 'ContactRect', 'Windows.Foundation.Rect', null, true);
  addProperty(registry, properties, 'MouseWheelDelta', 'int', 0, true);
  addProperty(registry, properties, 'Orientation', 'float', 0, true);
  if (!registry.types.has(uiInput + 'PointerUpdateKind')) registry.en(uiInput + 'PointerUpdateKind', {
    Other: 0, LeftButtonPressed: 1, LeftButtonReleased: 2, RightButtonPressed: 3, RightButtonReleased: 4,
    MiddleButtonPressed: 5, MiddleButtonReleased: 6, XButton1Pressed: 7, XButton1Released: 8,
    XButton2Pressed: 9, XButton2Released: 10 });
  addProperty(registry, properties, 'PointerUpdateKind', uiInput + 'PointerUpdateKind', 0, true);
  registerPointCollection(registry);
  registerPhysicalKeys(registry, input);
  registerManipulations(registry, input, uiInput);
  registerGestures(registry, input, uiInput);
  for (const [event, name] of Object.entries(inputArgumentTypes)) {
    const delegate = input + event + 'EventHandler';
    if (!registry.types.has(delegate)) registry.delegate(delegate, ['object', input + name]);
  }
}

function registerPointCollection(registry) {
  addType(registry, pointerPointEnumeratorType, { kind: 'interface', elementType: pointerPointType }, []);
  addProperty(registry, pointerPointEnumeratorType, 'Current', pointerPointType, null, true);
  addMethod(registry, pointerPointEnumeratorType, 'MoveNext', [], 'bool');
  addMethod(registry, pointerPointEnumeratorType, 'Reset', []);
  addMethod(registry, pointerPointEnumeratorType, 'Dispose', []);
  addType(registry, pointerPointEnumerableType, { kind: 'interface' }, []);
  addMethod(registry, pointerPointEnumerableType, 'GetEnumerator', [], pointerPointEnumeratorType);
  addType(registry, pointerPointCollectionType, { kind: 'interface', interfaces: [pointerPointEnumerableType] }, []);
  addProperty(registry, pointerPointCollectionType, 'Count', 'int', 0, true);
  addProperty(registry, pointerPointCollectionType, 'IsReadOnly', 'bool', true, true);
  addType(registry, pointerPointListType, { kind: 'interface', interfaces: [pointerPointCollectionType], elementType: pointerPointType }, []);
  addProperty(registry, pointerPointListType, 'Count', 'int', 0, true);
  addMethod(registry, pointerPointListType, 'get_Item', ['int'], pointerPointType, { kind: 'get', property: 'Item' });
  addMethod(registry, pointerPointListType, 'GetEnumerator', [], pointerPointEnumeratorType);
  addMethod(registry, registry.XAML + 'Input.PointerRoutedEventArgs', 'GetIntermediatePoints',
    [registry.XAML + 'UIElement'], pointerPointListType);
}

function registerPhysicalKeys(registry, input) {
  const status = 'Windows.UI.Core.CorePhysicalKeyStatus';
  const fields = { RepeatCount: 'uint', ScanCode: 'uint', IsExtendedKey: 'bool', IsMenuKeyDown: 'bool',
    WasKeyDown: 'bool', IsKeyReleased: 'bool' };
  addType(registry, status, { kind: 'value', slots: Object.keys(fields), base: 'System.ValueType' }, [[]]);
  for (const [name, type] of Object.entries(fields)) addProperty(registry, status, name, type, type === 'bool' ? false : 0);
  addProperty(registry, input + 'KeyRoutedEventArgs', 'KeyStatus', status, null, true);
  const character = input + 'CharacterReceivedRoutedEventArgs';
  addType(registry, character, { kind: 'object', base: registry.XAML + 'RoutedEventArgs' }, []);
  addProperty(registry, character, 'Character', 'char', '\0', true);
  addProperty(registry, character, 'KeyStatus', status, null, true);
}

function registerManipulations(registry, input, uiInput) {
  for (const [name, fields] of [['ManipulationDelta', { Translation: 'Windows.Foundation.Point', Scale: 'float', Rotation: 'float', Expansion: 'float' }],
    ['ManipulationVelocities', { Linear: 'Windows.Foundation.Point', Angular: 'float', Expansion: 'float' }]]) {
    addType(registry, uiInput + name, { kind: 'value', base: 'System.ValueType', slots: Object.keys(fields) }, [[]]);
    for (const [field, type] of Object.entries(fields)) addProperty(registry, uiInput + name, field, type,
      field === 'Scale' ? 1 : type === 'Windows.Foundation.Point' ? null : 0);
  }
  for (const [kind, desired] of [['Translation', 'Displacement'], ['Rotation', 'Rotation'], ['Expansion', 'Expansion']]) {
    const behavior = input + 'Inertia' + kind + 'Behavior';
    addType(registry, behavior, { kind: 'object' });
    addProperty(registry, behavior, 'DesiredDeceleration', 'double', NaN);
    addProperty(registry, behavior, 'Desired' + desired, 'double', NaN);
    for (const name of ['DesiredDeceleration', 'Desired' + desired]) {
      const property = registry.types.get(behavior).properties[name];
      property.metadata = { ...property.metadata, allowNaN: true };
    }
  }
  for (const name of ['Starting', 'Started', 'Delta', 'InertiaStarting', 'Completed']) {
    const type = input + 'Manipulation' + name + 'RoutedEventArgs';
    addType(registry, type, { kind: 'object', base: registry.XAML + 'RoutedEventArgs' });
    addProperty(registry, type, 'Container', registry.XAML + 'UIElement', null, name !== 'Starting');
    if (name === 'Starting') { addProperty(registry, type, 'Mode', input + 'ManipulationModes', 0); continue; }
    addProperty(registry, type, 'Cumulative', uiInput + 'ManipulationDelta', null, true);
    addProperty(registry, type, 'PointerDeviceType', uiInput + 'PointerDeviceType', 0, true);
    if (name !== 'InertiaStarting') addProperty(registry, type, 'Position', 'Windows.Foundation.Point', null, true);
    if (name !== 'Started') addProperty(registry, type, 'Velocities', uiInput + 'ManipulationVelocities', null, true);
    if (['Delta', 'InertiaStarting'].includes(name)) addProperty(registry, type, 'Delta', uiInput + 'ManipulationDelta', null, true);
    if (['Delta', 'Completed'].includes(name)) addProperty(registry, type, 'IsInertial', 'bool', false, true);
    if (['Started', 'Delta'].includes(name)) addMethod(registry, type, 'Complete', []);
    if (name === 'InertiaStarting') for (const kind of ['Translation', 'Rotation', 'Expansion']) {
      addProperty(registry, type, kind + 'Behavior', input + 'Inertia' + kind + 'Behavior');
    }
  }
}

function registerGestures(registry, input, uiInput) {
  if (!registry.types.has(uiInput + 'HoldingState')) registry.en(uiInput + 'HoldingState', { Started: 0, Completed: 1, Canceled: 2 });
  for (const name of ['Tapped', 'DoubleTapped', 'RightTapped', 'Holding']) {
    const type = input + name + 'RoutedEventArgs';
    addType(registry, type, { kind: 'object', base: registry.XAML + 'RoutedEventArgs' });
    addProperty(registry, type, 'PointerDeviceType', uiInput + 'PointerDeviceType', 0, true);
    addMethod(registry, type, 'GetPosition', [registry.XAML + 'UIElement'], 'Windows.Foundation.Point');
    if (name === 'Tapped') addProperty(registry, type, 'TapCount', 'uint', 1, true);
    if (name === 'Holding') addProperty(registry, type, 'HoldingState', uiInput + 'HoldingState', 0, true);
  }
}
