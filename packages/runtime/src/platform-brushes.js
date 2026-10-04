import {frameworkType, MEDIA} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';

const point = 'Windows.Foundation.Point';
const stop = MEDIA + 'GradientStop';
const collection = MEDIA + 'GradientStopCollection';

/** Scene values are detached records; their consumers must refresh when a nested managed value changes. */
export function isExportedFrameworkValue(type) {
  return ['value', 'brush'].includes(frameworkType(type)?.kind) || type === stop;
}

export function initializeGradientValues(platform, type, arguments_, values) {
  if (type === point) {
    const coordinates = arguments_.map(value => platform.native(value));
    if (coordinates.length !== 2 || coordinates.some(value => !Number.isFinite(value))) {
      throw new ManagedFault('ArgumentException', 'Point requires two finite coordinates');
    }
    values.X = platform.managed(coordinates[0], 'double');
    values.Y = platform.managed(coordinates[1], 'double');
  } else if (type === stop) {
    values.Color = platform.color('#00000000');
    platform.heap.pins.push(values.Color);
  } else if (type === MEDIA + 'LinearGradientBrush') {
    values.StartPoint = platform.construct(point, [0, 0]);
    values.EndPoint = platform.construct(point, [1, 1]);
  }
}

export function validateGradientProperty(platform, reference, name, value) {
  const type = platform.record(reference).type;
  if (type === MEDIA + 'LinearGradientBrush' && ['StartPoint', 'EndPoint'].includes(name)) {
    if (!isReference(value) || platform.heap.get(value).type !== point || ['X', 'Y'].some(key => {
      const coordinate = platform.native(platform.get(value, key));
      return !Number.isFinite(coordinate) || Math.abs(coordinate) > 100000;
    })) throw new ManagedFault('ArgumentOutOfRangeException', 'Gradient points require coordinates between -100000 and 100000');
  }
  if (type !== stop) return;
  if (name === 'Offset') {
    const offset = platform.native(value);
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
      throw new ManagedFault('ArgumentOutOfRangeException', 'Gradient offsets must be between zero and one');
    }
  } else if (name === 'Color' && value === null) {
    throw new ManagedFault('ArgumentException', 'A gradient stop requires a Color value');
  }
}

/** Enforce the registered collection element type before the generic collection mutates its contents. */
export function validateGradientCollection(platform, reference, name, arguments_) {
  if (platform.record(reference).type !== collection || !['Add', 'Insert'].includes(name)) return;
  const value = arguments_.at(-1);
  if (!isReference(value) || platform.heap.get(value).type !== stop) {
    throw new ManagedFault('ArgumentException', 'GradientStopCollection accepts non-null GradientStop values');
  }
}

export function refreshExportedFrameworkValue(platform, reference) {
  if (platform.valueConstructionDepth) return;
  const type = platform.record(reference).type;
  if (isExportedFrameworkValue(type) || type === collection) platform.command({op: 'reset', snapshot: platform.scene()});
}

/** Gradient collections travel inline only inside a brush record; ordinary scene collections retain their reference ABI. */
export function exportGradientStops(platform, value, exportValue, depth) {
  if (value === null) return [];
  if (!isReference(value) || platform.heap.get(value).type !== collection) {
    throw new ManagedFault('InvalidOperationException', 'Gradient brush has an invalid stop collection');
  }
  return platform.items(value).map(item => exportValue(platform, item, depth + 1));
}
