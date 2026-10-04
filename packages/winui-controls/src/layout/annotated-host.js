import { AnnotatedScrollController } from './annotated-scrollbar.js';

function publish(context, node, model) {
  const values = { Minimum: model.minimum, Maximum: model.maximum, Value: model.offset, ViewportSize: model.viewport,
    IsScrollingWithMouse: model.isScrollingWithMouse, IsScrollable: model.isScrollable };
  const state = context.getState(node), key = JSON.stringify(values);
  if (state.annotatedPublished === key) return;
  state.annotatedPublished = key;
  Object.assign(node.properties, values);
  context.emit(node, 'ControllerStateChanged', values);
  context.invalidate(node.id, 'arrange');
}

/** A controller stays private to its host; only range state and typed event payloads cross the worker boundary. */
export function getAnnotatedController(context, node) {
  const state = context.getState(node);
  if (state.annotatedController) return state.annotatedController;
  let model;
  model = new AnnotatedScrollController({ onChange: () => publish(context, node, model),
    onEvent(event, payload) {
      const controller = context.resolve?.(node.properties.ScrollController?.$ref);
      if (controller) context.emit(controller, event, payload);
    }, requestEvent: (event, payload, options) => {
      if (context.requestEvent) return context.requestEvent(node, event, payload, options);
      context.emit(node, event, payload);
      return Promise.resolve(payload);
    } });
  state.annotatedController = model;
  return model;
}

export function synchronizeAnnotatedController(context, node) {
  const model = getAnnotatedController(context, node), properties = { ...node.properties };
  if (!Number.isFinite(properties.SmallChange ?? 16) || (properties.SmallChange ?? 16) < 0) {
    throw new RangeError('SFUI1676: Annotated SmallChange must be a nonnegative finite value');
  }
  model.smallChange = properties.SmallChange ?? 16;
  model.setIsScrollable(properties.IsScrollable !== false);
  model.setValues(properties.Minimum ?? 0, properties.Maximum ?? 0, properties.Value ?? 0, properties.ViewportSize ?? 0);
  return model;
}
