import {ResourceFault} from '../resources/errors.js';

function dataField(value, name) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ResourceFault('SFTREE006', 'Effective viewport values must be plain data records.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new ResourceFault('SFTREE006', 'Effective viewport fields must be own data properties.');
  }
  return descriptor.value;
}

function rectangle(value) {
  const result = {};
  for (const name of ['x', 'y', 'width', 'height']) {
    const number = dataField(value, name);
    if (!Number.isFinite(number) || Math.abs(number) > 1e9 || (name === 'width' || name === 'height') && number < 0) {
      throw new ResourceFault('SFTREE006', 'Effective viewport rectangles must be bounded, finite, and non-negative in size.');
    }
    result[name] = number;
  }
  return result;
}

/** Clone every observable field; the legacy Rect argument remains shorthand for an unscrolled viewport. */
export function copyViewportPayload(value) {
  const full = value && Object.hasOwn(value, 'EffectiveViewport');
  const result = {EffectiveViewport: rectangle(full ? dataField(value, 'EffectiveViewport') : value),
    MaxViewport: rectangle(full ? dataField(value, 'MaxViewport') : value)};
  for (const name of ['BringIntoViewDistanceX', 'BringIntoViewDistanceY']) {
    const distance = full ? dataField(value, name) : 0;
    if (!Number.isFinite(distance) || distance < 0 || distance > 1e9) throw new ResourceFault('SFTREE006', 'Invalid bring-into-view distance.');
    result[name] = distance;
  }
  return result;
}

export function sameViewportPayload(left, right) {
  return !!left && ['EffectiveViewport', 'MaxViewport'].every(name => ['x', 'y', 'width', 'height']
    .every(field => left[name]?.[field] === right[name][field]))
    && left.BringIntoViewDistanceX === right.BringIntoViewDistanceX && left.BringIntoViewDistanceY === right.BringIntoViewDistanceY;
}
