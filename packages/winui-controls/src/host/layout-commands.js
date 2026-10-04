const methods = new Set(['Measure', 'Arrange', 'InvalidateMeasure', 'InvalidateArrange', 'UpdateLayout',
  'Focus', 'CapturePointer', 'ReleasePointerCapture', 'ReleasePointerCaptures', 'CompleteManipulation',
  'ChangeView', 'ScrollTo', 'ScrollBy', 'ZoomTo', 'RegisterAnchorCandidate', 'UnregisterAnchorCandidate', 'CompleteControllerScroll']);
const correlatedMethods = new Set(['ScrollTo', 'ScrollBy', 'ZoomTo']);

function copyArgument(value, infinite = false, depth = 0) {
  if (value == null || ['boolean', 'string'].includes(typeof value)) {
    if (typeof value === 'string' && value.length > 1024) throw new RangeError('Layout command string limit');
    return value;
  }
  if (typeof value === 'number' && (Number.isFinite(value) || infinite && value === Infinity)) return value;
  if (!value || typeof value !== 'object' || depth > 4 || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid layout command argument');
  const result = {};
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  if (entries.length > 32) throw new RangeError('Layout command argument limit');
  for (const [key, descriptor] of entries) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Invalid layout command field');
    }
    result[key] = copyArgument(descriptor.value, infinite, depth + 1);
  }
  return result;
}

/** Commands sent by the VM execute after visual synchronization and before geometry publication. */
export class HostLayoutCommands {
  constructor(host) { this.host = host; this.queue = []; }
  enqueue(command) {
    if (!methods.has(command.method) || !Array.isArray(command.args) || command.args.length > 4
      || command.id != null && typeof command.id !== 'string') throw new TypeError('Invalid layout command');
    if (this.queue.length >= 4096) throw new RangeError('Pending layout command limit');
    if (command.correlationId != null && (!correlatedMethods.has(command.method) || !Number.isSafeInteger(command.correlationId)
      || command.correlationId <= 0 || command.correlationId > 2147483647)) throw new TypeError('Invalid layout correlation id');
    if (command.method.startsWith('Invalidate')) {
      if (command.id != null) this.host.invalidate(command.id, command.method === 'InvalidateArrange' ? 'arrange' : 'measure');
      return;
    }
    if (command.method === 'UpdateLayout') return;
    this.queue.push({ id: command.id, method: command.method,
      correlationId: command.correlationId, args: command.args.map(value => copyArgument(value, command.method === 'Measure')) });
  }
  apply() {
    for (const command of this.queue.splice(0)) {
      if (!this.host.nodes.has(command.id)) continue;
      if (command.correlationId != null) command.args[2] = { ...command.args[2], correlationId: command.correlationId };
      this.host.layoutOperations.invoke(command.id, command.method, command.args);
    }
  }
  clear() { this.queue.length = 0; }
}

export function publishLayoutFeedback(host, changes, notifyLayout) {
  if (notifyLayout && changes.length) {
    for (const change of changes) {
      host.layouts.set(change.id, [change.width, change.height]);
      const { node, ...layout } = host.worldLayout.get(change.id);
      change.rect = layout.rect;
      change.layout = layout;
    }
    host.options.onLayout(changes);
  }
  host.options.onLayoutSnapshot?.(host.layoutSnapshot());
}
