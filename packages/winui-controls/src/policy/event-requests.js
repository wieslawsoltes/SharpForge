/** Returns the acknowledged host channel when a worker or asynchronous application owns event handlers. */
export function controlEventRequester(context) {
  if (typeof context.requestEvent === 'function') return context.requestEvent.bind(context);
  if (typeof context.host?.requestEvent === 'function') return (node, name, payload, options) => context.host.requestEvent(node.id ?? node, name, payload, options);
  return null;
}

/** Notifications keep emit's synchronous path; decisions await exactly one handler dispatch. */
export function requestControlEvent(context, node, name, payload, options = {}) {
  const request = controlEventRequester(context);
  if (request) return Promise.resolve(request(node, name, payload, options)).then(result => ({ ...payload, ...result }));
  context.emit(node, name, payload);
  return Promise.resolve(payload);
}

/** Hold an existing browser deferral until managed handlers and their deferrals have completed. */
export function forwardDeferredControlEvent(context, node, name, args) {
  if (!controlEventRequester(context)) {
    context.emit(node, name, args);
    return;
  }
  const lease = args.GetDeferral();
  const payload = Object.fromEntries(Object.entries(args).filter(([name, value]) => name !== 'requestSignal' && typeof value !== 'function'));
  requestControlEvent(context, node, name, payload, { signal: args.requestSignal }).then(result => {
    args.Cancel ||= result.Cancel === true;
    args.Handled ||= result.Handled === true;
  }, error => {
    args.Cancel = true;
    context.host.options.onError?.(error);
  }).finally(() => lease.Complete());
}
