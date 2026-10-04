import { registerDragContracts } from './drag-input.js';
import { addType, addProperty, addMethod, addEvent } from './contract-registration.js';
import { registerInputPayloadContracts, inputArgumentTypes } from './input-payloads.js';

/** Typed input contracts share one contributor; renderer event payloads use these exact property names. */
export function registerInputContracts(registry) {
  const { XAML } = registry;
  const input = XAML + 'Input.';
  const uiInput = 'Microsoft.UI.Input.';
  const enumType = (name, values) => { if (!registry.types.has(name)) registry.en(name, values); };
  enumType(XAML + 'FocusState', { Unfocused: 0, Pointer: 1, Keyboard: 2, Programmatic: 3 });
  enumType(input + 'KeyboardNavigationMode', { Local: 0, Cycle: 1, Once: 2 });
  enumType(input + 'FocusNavigationDirection', { Next: 0, Previous: 1, Up: 2, Down: 3, Left: 4, Right: 5, None: 6 });
  enumType(input + 'ManipulationModes', { None: 0, TranslateX: 1, TranslateY: 2, TranslateRailsX: 4, TranslateRailsY: 8, Rotate: 16, Scale: 32,
    TranslateInertia: 64, RotateInertia: 128, ScaleInertia: 256, All: 65535, System: 65536 });
  enumType('Windows.System.VirtualKey', virtualKeys());
  enumType('Windows.System.VirtualKeyModifiers', { None: 0, Control: 1, Menu: 2, Shift: 4, Windows: 8 });
  addType(registry, input + 'Pointer', { kind: 'object' }, []);
  addProperty(registry, input + 'Pointer', 'PointerId', 'uint', 0, true);
  addProperty(registry, input + 'Pointer', 'IsInContact', 'bool', false, true);
  addType(registry, uiInput + 'PointerPoint', { kind: 'object' }, []);
  addProperty(registry, uiInput + 'PointerPoint', 'Position', 'Windows.Foundation.Point', null, true);
  addProperty(registry, uiInput + 'PointerPoint', 'PointerId', 'uint', 0, true);
  addType(registry, uiInput + 'PointerPointProperties', { kind: 'object' }, []);
  addProperty(registry, uiInput + 'PointerPoint', 'Properties', uiInput + 'PointerPointProperties', null, true);
  for (const name of ['IsLeftButtonPressed', 'IsRightButtonPressed', 'IsMiddleButtonPressed', 'IsPrimary', 'IsEraser']) {
    addProperty(registry, uiInput + 'PointerPointProperties', name, 'bool', false, true);
  }
  for (const name of ['Pressure', 'XTilt', 'YTilt', 'Twist']) addProperty(registry, uiInput + 'PointerPointProperties', name, 'float', 0, true);
  registerRoutedArguments(registry, input);
  registerInputPayloadContracts(registry);
  registerDragContracts(registry);
  for (const name of ['PointerPressed', 'PointerMoved', 'PointerReleased', 'PointerEntered', 'PointerExited', 'PointerCanceled',
    'PointerCaptureLost', 'PointerWheelChanged']) addEvent(registry, XAML + 'UIElement', name, input + 'PointerEventHandler');
  for (const name of ['KeyDown', 'KeyUp', 'PreviewKeyDown', 'PreviewKeyUp']) addEvent(registry, XAML + 'UIElement', name, input + 'KeyEventHandler');
  for (const name of ['GotFocus', 'LostFocus', 'GettingFocus', 'LosingFocus', 'NoFocusCandidateFound', 'CharacterReceived',
    'Tapped', 'DoubleTapped', 'RightTapped', 'Holding', 'ManipulationStarting', 'ManipulationStarted', 'ManipulationDelta',
    'ManipulationInertiaStarting', 'ManipulationCompleted']) {
    addEvent(registry, XAML + 'UIElement', name, inputArgumentTypes[name] ? input + name + 'EventHandler' : undefined);
  }
  for (const name of ['IsTapEnabled', 'IsDoubleTapEnabled', 'IsRightTapEnabled', 'IsHoldingEnabled']) {
    addProperty(registry, XAML + 'UIElement', name, 'bool', true);
  }
  for (const name of ['CanDrag', 'AllowDrop']) addProperty(registry, XAML + 'UIElement', name, 'bool', false);
  addProperty(registry, XAML + 'UIElement', 'ManipulationMode', input + 'ManipulationModes', 0);
  addProperty(registry, XAML + 'UIElement', 'TabFocusNavigation', input + 'KeyboardNavigationMode', 0);
  for (const name of ['XYFocusUp', 'XYFocusDown', 'XYFocusLeft', 'XYFocusRight']) addProperty(registry, XAML + 'UIElement', name, XAML + 'DependencyObject');
  addMethod(registry, XAML + 'UIElement', 'CapturePointer', [input + 'Pointer'], 'bool');
  addMethod(registry, XAML + 'UIElement', 'ReleasePointerCapture', [input + 'Pointer']);
  addMethod(registry, XAML + 'UIElement', 'ReleasePointerCaptures', []);
  addMethod(registry, XAML + 'UIElement', 'Focus', [XAML + 'FocusState'], 'bool');
  addType(registry, input + 'FocusManager', { kind: 'static' }, []);
  addMethod(registry, input + 'FocusManager', 'GetFocusedElement', [], 'object', { isStatic: true });
  addMethod(registry, input + 'FocusManager', 'TryMoveFocus', [input + 'FocusNavigationDirection'], 'bool', { isStatic: true });
  addMethod(registry, input + 'FocusManager', 'FindNextElement', [input + 'FocusNavigationDirection'], XAML + 'DependencyObject', { isStatic: true });
}

function registerRoutedArguments(registry, input) {
  const { XAML } = registry;
  for (const name of ['PointerRoutedEventArgs', 'KeyRoutedEventArgs']) {
    addType(registry, input + name, { base: XAML + 'RoutedEventArgs', kind: 'object' }, []);
  }
  addProperty(registry, input + 'PointerRoutedEventArgs', 'Pointer', input + 'Pointer', null, true);
  addProperty(registry, input + 'PointerRoutedEventArgs', 'KeyModifiers', 'Windows.System.VirtualKeyModifiers', 0, true);
  addMethod(registry, input + 'PointerRoutedEventArgs', 'GetCurrentPoint', [XAML + 'UIElement'], 'Microsoft.UI.Input.PointerPoint');
  addProperty(registry, input + 'KeyRoutedEventArgs', 'Key', 'Windows.System.VirtualKey', 0, true);
  addProperty(registry, input + 'KeyRoutedEventArgs', 'OriginalKey', 'Windows.System.VirtualKey', 0, true);
  for (const [name, argument] of [['PointerEventHandler', 'PointerRoutedEventArgs'], ['KeyEventHandler', 'KeyRoutedEventArgs']]) {
    if (!registry.types.has(input + name)) registry.delegate(input + name, ['object', input + argument]);
  }
}

function virtualKeys() {
  const values = { None: 0, Back: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Menu: 18, Pause: 19,
    CapitalLock: 20, Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
    Left: 37, Up: 38, Right: 39, Down: 40, Insert: 45, Delete: 46 };
  for (let index = 0; index < 10; index++) values['Number' + index] = 48 + index;
  for (let index = 0; index < 26; index++) values[String.fromCharCode(65 + index)] = 65 + index;
  for (let index = 1; index <= 24; index++) values['F' + index] = 111 + index;
  return values;
}
