export const PointerEventNames = Object.freeze({
  pointerdown: 'PointerPressed', pointermove: 'PointerMoved', pointerup: 'PointerReleased',
  pointerenter: 'PointerEntered', pointerleave: 'PointerExited', pointercancel: 'PointerCanceled',
  lostpointercapture: 'PointerCaptureLost', wheel: 'PointerWheelChanged'
});

export const PointerDeviceType = Object.freeze({ Touch: 0, Pen: 1, Mouse: 2, Touchpad: 3 });
export const pointerDeviceType = type => ({ touch: 0, pen: 1, mouse: 2, touchpad: 3 }[type] ?? 2);

/** Pointer coordinates are root DIPs; hardware values retain their browser-provided precision. */
export function pointerEventArgs(event, position) {
  const buttons = event.buttons ?? 0;
  const sx = position.scaleX ?? 1, sy = position.scaleY ?? 1;
  const horizontal = Math.abs(event.deltaX ?? 0) > Math.abs(event.deltaY ?? 0);
  const deviceType = pointerDeviceType(event.pointerType);
  const released = event.type === 'pointerup';
  const changedButton = event.type === 'pointerdown' || released ? [1, 5, 3, 7, 9][event.button] ?? 0 : 0;
  const point = {
    PointerId: event.pointerId ?? 1, Position: { X: position.x, Y: position.y },
    Timestamp: Math.round((event.timeStamp ?? 0) * 1000), FrameId: event.frameId ?? 0,
    PointerDeviceType: deviceType, IsInContact: buttons !== 0,
    Properties: { IsLeftButtonPressed: !!(buttons & 1), IsRightButtonPressed: !!(buttons & 2),
      IsMiddleButtonPressed: !!(buttons & 4), IsXButton1Pressed: !!(buttons & 8), IsXButton2Pressed: !!(buttons & 16),
      Pressure: event.pressure ?? (buttons ? 0.5 : 0), XTilt: event.tiltX ?? 0, YTilt: event.tiltY ?? 0,
      Twist: event.twist ?? 0, IsPrimary: event.isPrimary ?? true, IsEraser: event.button === 5,
      IsBarrelButtonPressed: event.pointerType === 'pen' && !!(buttons & 2), IsCanceled: event.type === 'pointercancel',
      IsInRange: event.type !== 'pointerout' && event.type !== 'pointercancel', IsInverted: event.button === 5,
      TouchConfidence: false, Orientation: 0, PointerUpdateKind: changedButton ? changedButton + Number(released) : 0,
      MouseWheelDelta: Math.round(-(horizontal ? event.deltaX ?? 0 : event.deltaY ?? 0)),
      IsHorizontalMouseWheel: horizontal,
      ContactRect: { X: position.x - (event.width ?? 1) * sx / 2, Y: position.y - (event.height ?? 1) * sy / 2,
        Width: (event.width ?? 1) * sx, Height: (event.height ?? 1) * sy } }
  };
  const points = (event.getCoalescedEvents?.() ?? []).slice(-255).map(value => ({ ...point,
    Timestamp: Math.round((value.timeStamp ?? event.timeStamp ?? 0) * 1000),
    Position: { X: position.x + (value.clientX - event.clientX) * sx, Y: position.y + (value.clientY - event.clientY) * sy },
    Properties: { ...point.Properties, Pressure: value.pressure ?? point.Properties.Pressure,
      XTilt: value.tiltX ?? point.Properties.XTilt, YTilt: value.tiltY ?? point.Properties.YTilt,
      Twist: value.twist ?? point.Properties.Twist, ContactRect: { ...point.Properties.ContactRect,
        X: point.Properties.ContactRect.X + (value.clientX - event.clientX) * sx,
        Y: point.Properties.ContactRect.Y + (value.clientY - event.clientY) * sy } } }));
  const last = points.at(-1);
  if (last?.Timestamp !== point.Timestamp || last?.Position.X !== point.Position.X || last?.Position.Y !== point.Position.Y) points.push(point);
  else points[points.length - 1] = point;
  return {
    Pointer: { PointerId: point.PointerId, PointerDeviceType: deviceType, IsInContact: point.IsInContact,
      IsInRange: point.Properties.IsInRange },
    CurrentPoint: point, KeyModifiers: modifierFlags(event),
    GetCurrentPoint: () => point,
    GetIntermediatePoints: () => points
  };
}

export function modifierFlags(event) {
  return (event.ctrlKey ? 1 : 0) | (event.altKey ? 2 : 0) | (event.shiftKey ? 4 : 0) | (event.metaKey ? 8 : 0);
}
