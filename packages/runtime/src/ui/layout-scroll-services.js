import { normalizeScrollOptions } from '@sharpforge/winui-controls';
import { ManagedFault } from '../heap.js';
import { scrollMetrics } from './layout-feedback.js';

export const managedScrollMethods = new Set(['ChangeView', 'ScrollTo', 'ScrollBy', 'ZoomTo']);
const metrics = ['HorizontalOffset', 'VerticalOffset', 'ZoomFactor', 'ExtentWidth', 'ExtentHeight',
  'ViewportWidth', 'ViewportHeight', 'ScrollableWidth', 'ScrollableHeight'];

function validateArguments(method, args) {
  const expected = method === 'ChangeView' ? [3, 4] : [2, 3];
  if (!expected.includes(args.length)) throw new ManagedFault('ArgumentException', 'Invalid scroll argument count');
  const count = method === 'ChangeView' ? 3 : method === 'ZoomTo' ? 1 : 2;
  for (let index = 0; index < count; index++) {
    if (args[index] == null && method === 'ChangeView') continue;
    if (!Number.isFinite(args[index]) || Math.abs(args[index]) > 1e9) throw new ManagedFault('ArgumentException', 'Invalid scroll coordinate');
  }
  if (method === 'ChangeView') {
    if (args.length === 4 && typeof args[3] !== 'boolean') throw new ManagedFault('ArgumentException', 'Invalid animation flag');
    return;
  }
  normalizeScrollOptions(args[2] ?? {});
  if (method !== 'ZoomTo' || args[1] == null) return;
  const point = args[1];
  if (![point.X ?? point.x, point.Y ?? point.y].every(Number.isFinite)) {
    throw new ManagedFault('ArgumentException', 'Invalid zoom center point');
  }
}

/** A live browser completes scroll operations. Headless execution uses the same synchronous model and its injected frame clock. */
export function invokeBrowserScroll(service, id, method, args) {
  if (!managedScrollMethods.has(method) || typeof service.context.platform?.options.uiHostRequest !== 'function') return null;
  validateArguments(method, args);
  if (method === 'ChangeView') {
    service.notify(id, method, args);
    return { value: true };
  }
  const correlationId = service.nextScrollCorrelationId++;
  if (correlationId > 2147483647) throw new ManagedFault('InvalidOperationException', 'SFUI1673: Scroll correlation id exhausted');
  service.notify(id, method, args, { correlationId });
  return { value: correlationId };
}

export function observeManagedScroll(service, receiver, event, payload) {
  if (!['ViewChanged', 'ScrollCompleted', 'ZoomCompleted'].includes(event)) return;
  const id = service.identity(receiver);
  const state = service.engine.states.get(id);
  if (!state) return;
  for (const property of metrics) {
    const value = payload[property];
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0 || value > 1e9 || property === 'ZoomFactor' && value === 0) {
      throw new ManagedFault('ArgumentException', 'Invalid browser scroll metrics');
    }
    service.setOutput(id, property, value);
  }
  const properties = state.node.properties;
  state.data.scroll = { extent: { width: properties.ExtentWidth ?? 0, height: properties.ExtentHeight ?? 0 },
    viewport: { width: properties.ViewportWidth ?? 0, height: properties.ViewportHeight ?? 0 },
    horizontalOffset: properties.HorizontalOffset ?? 0, verticalOffset: properties.VerticalOffset ?? 0, zoomFactor: properties.ZoomFactor ?? 1 };
  for (const [property, value] of Object.entries(scrollMetrics(state))) service.setOutput(id, property, value);
}
