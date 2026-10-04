/** Worker messages select only explicit control operations; member lookup on the host is never permitted. */
export const hostControlOperations = Object.freeze([
  'Measure', 'Arrange', 'InvalidateMeasure', 'InvalidateArrange', 'UpdateLayout', 'Focus',
  'CapturePointer', 'ReleasePointerCapture', 'ReleasePointerCaptures', 'CompleteManipulation',
  'GetFocusedElement', 'TryMoveFocus', 'FindNextElement', 'ChangeView', 'ScrollTo', 'ScrollBy', 'ZoomTo',
  'RegisterAnchorCandidate', 'UnregisterAnchorCandidate', 'GetCurrentAnchor', 'GetScrollMetrics', 'CompleteControllerScroll',
  'TryGetElement', 'GetElementIndex', 'Invoke', 'Toggle', 'SetValue', 'GetText', 'SelectText',
  'Select', 'SelectAll', 'DeselectAll', 'AddToSelection', 'RemoveFromSelection', 'Scroll', 'SetScrollPercent',
  'ScrollIntoView', 'Expand', 'Collapse', 'ShowAt', 'ShowAsync', 'Hide', 'Close', 'Open', 'GoBack', 'GoForward', 'Navigate'
]);
const allowed = new Set(hostControlOperations);
export const isHostControlOperation = name => typeof name === 'string' && allowed.has(name);

export function invokeHostControl(host, id, name, args = []) {
  if (!isHostControlOperation(name) || !Array.isArray(args) || args.length > 16) throw new TypeError('Unsupported host control operation');
  return host.invoke(id, name, args);
}
