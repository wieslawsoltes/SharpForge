import {DataPackage} from '@sharpforge/winui-controls';
import {ManagedFault} from '../heap.js';

function requireRequest(context) {
  const request = context.platform.options.uiHostRequest;
  if (typeof request !== 'function') throw new ManagedFault('NotSupportedException', 'This UI operation requires a browser host capability');
  return request;
}

function readPackage(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.values) || snapshot.values.length > 3) {
    throw new ManagedFault('ArgumentException', 'Invalid browser data package');
  }
  const data = new DataPackage();
  for (const [format, value] of snapshot.values) data.set(format, value);
  data.RequestedOperation = snapshot.requestedOperation ?? 0;
  return data;
}

/** Browser capabilities project data and promises; UI state and identity remain owned by the VM. */
export function initializeManagedHostServices(context) {
  const {platform, services} = context, explicit = platform.options.uiServices ?? {};
  services.uiHostRequest ??= platform.options.uiHostRequest;
  services.controls ??= {invoke: (owner, method, args) => {
    const promise = requireRequest(context)('control', {id: context.id(owner), method,
      args: args.map(value => platform.exportValue(value))});
    if (context.currentInvocation?.descriptor?.result !== 'void') return promise;
    context.task(promise, {resultType: 'void', roots: [owner]});
    return null;
  }};
  services.renderToBitmap ??= (owner, options = {}) => requireRequest(context)('renderToBitmap', {
    id: context.id(owner), width: options.width, height: options.height
  }, {signal: options.signal});
  if (!platform.options.uiHostRequest) return;
  if (!explicit.clipboard) services.clipboard = {
    async getContent({signal} = {}) {
      signal?.throwIfAborted();
      const result = await requireRequest(context)('clipboard', {method: 'GetContent', args: []}, {signal});
      signal?.throwIfAborted();
      return {...result, data: result.ok && result.data ? readPackage(result.data) : null};
    },
    async setContent(data, {signal} = {}) {
      signal?.throwIfAborted();
      if (!(data instanceof DataPackage)) throw new TypeError('Clipboard content requires a DataPackage');
      const result = await requireRequest(context)('clipboard', {method: 'SetContent', args: [data.snapshot()]}, {signal});
      signal?.throwIfAborted();
      return result;
    }
  };
  if (!explicit.launcher) services.launcher = {
    async launchUri(uri, {signal} = {}) {
      signal?.throwIfAborted();
      const result = await requireRequest(context)('launcher', {uri}, {signal});
      signal?.throwIfAborted();
      return result === true;
    }
  };
}
