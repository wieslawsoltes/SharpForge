import {eventsFor, frameworkType, propertiesFor, XAML} from '@sharpforge/framework';
import {ManagedFault} from './heap.js';

const identity = reference => `${reference.h}:${reference.g}`;

/** Queue registered managed delegates with typed arguments; the scheduler owns their GC roots and execution lifetime. */
export function enqueuePlatformEvent(platform, reference, event, suppliedArgs = null) {
  const record = platform.record(reference);
  const expected = frameworkType(eventsFor(record.type)[event])?.parameters[1] ?? XAML + 'RoutedEventArgs';
  if (!suppliedArgs && expected !== XAML + 'RoutedEventArgs') {
    throw new ManagedFault('InvalidOperationException', 'Typed layout events require a validated visual layout measurement');
  }
  const list = platform.get(reference, '$event:' + event);
  const handlers = list ? [...platform.heap.get(list).data] : [];
  if (!handlers.length) return [];
  return platform.heap.withRoots([reference, suppliedArgs, ...handlers], () => {
    const args = suppliedArgs ?? platform.make(XAML + 'RoutedEventArgs', {OriginalSource: reference, Handled: false});
    platform.heap.pins.push(args);
    return handlers.map(handler => platform.vm.scheduler.enqueue(handler, [reference, args], {
      name: record.type.split('.').at(-1) + '.' + event, kind: 'ui'
    }));
  });
}

function windowMeasurement(platform, reference, width, height) {
  if (!platform.windows.has(identity(reference))) return;
  if (platform.get(reference, '$layout:width') === width && platform.get(reference, '$layout:height') === height) return;
  platform.set(reference, '$layout:width', width);
  platform.set(reference, '$layout:height', height);
  const handlers = platform.get(reference, '$event:SizeChanged');
  if (!handlers || !platform.heap.get(handlers).data.length) return;
  const size = platform.make('Windows.Foundation.Size', {
    Width: platform.managed(width, 'double'), Height: platform.managed(height, 'double')
  });
  platform.heap.withRoots([reference, size], () => {
    const args = platform.make(XAML + 'WindowSizeChangedEventArgs', {Size: size, Handled: platform.managed(false, 'bool')});
    enqueuePlatformEvent(platform, reference, 'SizeChanged', args);
  });
}

/** Validate the whole bounded batch before writes. Repeated window records dispatch only the latest effective-pixel size. */
export function updatePlatformLayout(platform, changes) {
  if (!Array.isArray(changes) || changes.length > 10000) throw new RangeError('Layout update limit');
  const visible = new Set(platform.scene().nodes.map(node => node.id));
  const latest = new Map();
  for (const change of changes) {
    if (!change || !visible.has(change.id) || !Number.isFinite(change.width) || !Number.isFinite(change.height)
      || change.width < 0 || change.height < 0 || change.width > 100000 || change.height > 100000) {
      throw new TypeError('Invalid visual layout measurement');
    }
    latest.set(change.id, change);
  }
  for (const {id, width, height} of latest.values()) {
    const [h, g] = id.split(':').map(Number);
    const reference = Object.freeze({h, g});
    const properties = propertiesFor(platform.record(reference).type);
    for (const [name, value] of [['ActualWidth', width], ['ActualHeight', height]]) {
      if (Object.hasOwn(properties, name)) platform.set(reference, name, platform.managed(value, 'double'));
    }
    windowMeasurement(platform, reference, width, height);
  }
  return changes.length;
}
