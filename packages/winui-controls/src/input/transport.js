import { inverseMatrix, transformPoint, transformBounds } from '../layout/render-properties.js';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const pointerKinds = new Set(['mouse', 'touch', 'pen', 'touchpad', 0, 1, 2, 3]);
const pointLimit = 256;

/** Clone routed event data without callbacks, DOM objects, accessors or unbounded recursive values. */
export function serializeRoutedEvent(event) {
  if (!event || typeof event !== 'object') throw new TypeError('SFUI1663: Routed event data must be an object');
  const budget = { nodes: 0, characters: 0 };
  const active = new Set();
  const clone = (value, depth) => {
    if (++budget.nodes > 32768 || depth > 12) throw new RangeError('SFUI1664: Routed event data limit');
    if (value === undefined || typeof value === 'function') return undefined;
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('SFUI1663: Routed event numbers must be finite');
      return value;
    }
    if (typeof value === 'string') {
      budget.characters += value.length;
      if (budget.characters > 65536) throw new RangeError('SFUI1664: Routed event text limit');
      return value;
    }
    if (typeof value !== 'object' || active.has(value)) throw new TypeError('SFUI1663: Routed event data contains a cycle or unsupported value');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('SFUI1663: Host objects require an explicit routed-event projection');
    }
    if (Array.isArray(value) && value.length > 1024) throw new RangeError('SFUI1664: Routed event collection limit');
    active.add(value);
    const result = Array.isArray(value) ? [] : {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (key === 'length' && Array.isArray(value)) continue;
      if (forbiddenKeys.has(key) || descriptor.get || descriptor.set) throw new TypeError('SFUI1663: Invalid routed-event member');
      const child = clone(descriptor.value, depth + 1);
      if (child !== undefined) result[key] = child;
    }
    active.delete(value);
    return result;
  };
  const result = clone(event, 0);
  if (event.CurrentPoint) {
    result.CurrentPoint = validatePointerPoint(result.CurrentPoint);
    const intermediate = event.IntermediatePoints ?? event.GetIntermediatePoints?.() ?? [event.CurrentPoint];
    if (!Array.isArray(intermediate)) throw new TypeError('SFUI1663: Intermediate points must be an array');
    result.IntermediatePoints = intermediate.slice(-pointLimit).map(point => validatePointerPoint(clone(point, 1)));
    const last = result.IntermediatePoints.at(-1);
    if (last?.Timestamp !== result.CurrentPoint.Timestamp || last?.Position.X !== result.CurrentPoint.Position.X
      || last?.Position.Y !== result.CurrentPoint.Position.Y) {
      if (result.IntermediatePoints.length === pointLimit) result.IntermediatePoints.shift();
      result.IntermediatePoints.push(result.CurrentPoint);
    } else result.IntermediatePoints[result.IntermediatePoints.length - 1] = result.CurrentPoint;
    result.Pointer = pointerIdentity(result.Pointer, result.CurrentPoint);
    if (result.Pointer.PointerId !== result.CurrentPoint.PointerId) throw new TypeError('SFUI1663: Inconsistent pointer identity');
    for (const point of [result.CurrentPoint, ...result.IntermediatePoints]) {
      if (point.PointerId !== result.Pointer.PointerId) throw new TypeError('SFUI1663: Intermediate point belongs to another pointer');
      point.PointerDeviceType = result.Pointer.PointerDeviceType;
    }
  }
  return result;
}

function bounded(value, minimum, maximum, name, fallback = minimum) {
  value ??= fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError('SFUI1663: Invalid pointer ' + name);
  return value;
}

function pointerIdentity(pointer = {}, point) {
  const id = bounded(pointer.PointerId ?? point.PointerId, 0, 0xffffffff, 'id');
  if (!Number.isInteger(id)) throw new TypeError('SFUI1663: Pointer id must be an integer');
  const type = pointer.PointerDeviceType ?? point.PointerDeviceType ?? 'mouse';
  if (!pointerKinds.has(type)) throw new TypeError('SFUI1663: Unknown pointer device type');
  return { PointerId: id, PointerDeviceType: typeof type === 'string' ? { touch: 0, pen: 1, mouse: 2, touchpad: 3 }[type] : type,
    IsInContact: !!(pointer.IsInContact ?? point.IsInContact), IsInRange: !!(pointer.IsInRange ?? point.Properties.IsInRange) };
}

export function validatePointerPoint(value) {
  if (!value || typeof value !== 'object' || !value.Position) throw new TypeError('SFUI1663: Missing pointer point');
  const position = { X: bounded(value.Position.X ?? value.Position.x, -1e9, 1e9, 'X', 0),
    Y: bounded(value.Position.Y ?? value.Position.y, -1e9, 1e9, 'Y', 0) };
  const properties = value.Properties ?? {};
  const normalized = {};
  for (const name of ['IsLeftButtonPressed', 'IsRightButtonPressed', 'IsMiddleButtonPressed', 'IsXButton1Pressed',
    'IsXButton2Pressed', 'IsPrimary', 'IsEraser', 'IsHorizontalMouseWheel', 'IsBarrelButtonPressed', 'IsCanceled',
    'IsInRange', 'IsInverted', 'TouchConfidence']) normalized[name] = !!properties[name];
  normalized.Pressure = bounded(properties.Pressure, 0, 1, 'pressure');
  normalized.XTilt = bounded(properties.XTilt, -90, 90, 'tilt', 0);
  normalized.YTilt = bounded(properties.YTilt, -90, 90, 'tilt', 0);
  normalized.Twist = bounded(properties.Twist, 0, 359, 'twist');
  normalized.Orientation = bounded(properties.Orientation, 0, 360, 'orientation');
  normalized.PointerUpdateKind = bounded(properties.PointerUpdateKind, 0, 10, 'update kind');
  if (!Number.isInteger(normalized.PointerUpdateKind)) throw new TypeError('SFUI1663: Invalid pointer update kind');
  normalized.MouseWheelDelta = bounded(properties.MouseWheelDelta, -1e9, 1e9, 'wheel', 0);
  const contact = properties.ContactRect ?? {};
  normalized.ContactRect = { X: bounded(contact.X, -1e9, 1e9, 'contact X', position.X),
    Y: bounded(contact.Y, -1e9, 1e9, 'contact Y', position.Y),
    Width: bounded(contact.Width, 0, 1e9, 'contact width'), Height: bounded(contact.Height, 0, 1e9, 'contact height') };
  const id = bounded(value.PointerId, 0, 0xffffffff, 'id');
  if (!Number.isInteger(id)) throw new TypeError('SFUI1663: Pointer id must be an integer');
  const device = pointerIdentity({ PointerDeviceType: value.PointerDeviceType }, { ...value, Properties: normalized });
  return { PointerId: id, Position: position, PointerDeviceType: device.PointerDeviceType,
    FrameId: Math.trunc(bounded(value.FrameId, 0, 0xffffffff, 'frame id')),
    Timestamp: bounded(value.Timestamp, 0, Number.MAX_SAFE_INTEGER, 'timestamp'),
    IsInContact: !!value.IsInContact, Properties: normalized };
}

/** Recreate convenience methods only at the receiving boundary; the wire representation stays data-only. */
export function hydratePointerEvent(data, layoutService = null) {
  const result = serializeRoutedEvent(data);
  if (!result.CurrentPoint || !result.Pointer) throw new TypeError('SFUI1663: Pointer event requires pointer data');
  if (!Number.isInteger(result.KeyModifiers ?? 0) || result.KeyModifiers < 0 || result.KeyModifiers > 15) {
    throw new RangeError('SFUI1663: Invalid key modifiers');
  }
  const getLayout = typeof layoutService === 'function' ? layoutService : layoutService?.getLayout?.bind(layoutService);
  const defaultRelative = getLayout ? null : layoutService;
  const relativePoint = (point, relativeTo) => {
    if (relativeTo == null) return copyPoint(point);
    const id = typeof relativeTo === 'string' ? relativeTo : relativeTo.$ref ?? relativeTo.id;
    const layout = getLayout ? getLayout(id) : relativeTo;
    if (!layout?.worldTransform) throw new TypeError('SFUI1663: Relative pointer target has no layout transform');
    const inverse = inverseMatrix(layout.worldTransform);
    if (!inverse) throw new Error('SFUI1665: Relative pointer target transform is singular');
    const position = transformPoint(inverse, { x: point.Position.X, y: point.Position.Y });
    const rect = point.Properties.ContactRect;
    const contact = transformBounds(inverse, { x: rect.X, y: rect.Y, width: rect.Width, height: rect.Height });
    return { ...copyPoint(point), Position: { X: position.x, Y: position.y },
      Properties: { ...point.Properties, ContactRect: { X: contact.x, Y: contact.y, Width: contact.width, Height: contact.height } } };
  };
  result.GetCurrentPoint = (relativeTo = defaultRelative) => relativePoint(result.CurrentPoint, relativeTo);
  result.GetIntermediatePoints = (relativeTo = defaultRelative) => result.IntermediatePoints.map(point => relativePoint(point, relativeTo));
  return result;
}

function copyPoint(point) {
  return { ...point, Position: { ...point.Position }, Properties: { ...point.Properties, ContactRect: { ...point.Properties.ContactRect } } };
}
