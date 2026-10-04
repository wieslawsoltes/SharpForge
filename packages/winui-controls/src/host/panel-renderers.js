import { makeElement } from './dom-properties.js';
import { registerAnnotatedScrollRenderer } from './annotated-renderer.js';

export function registerPanelRenderers(registry) {
  registerAnnotatedScrollRenderer(registry);
  registry.register('TwoPaneView', { create: context => makeElement(context), render(context, node, element) {
    context.ordered(element, ['Pane1', 'Pane2'].map(name => node.properties[name]?.$ref)
      .filter(Boolean).map(id => context.host.ensure(id)).filter(Boolean));
  }, afterLayout(context, node) {
    const mode = { SinglePane: 0, Wide: 1, Tall: 2 }[context.host.layoutEngine.states.get(node.id)?.data.mode] ?? 0;
    const state = context.getState(node);
    node.properties.Mode = mode;
    if (state.twoPaneMode !== mode) { state.twoPaneMode = mode; context.emit(node, 'ModeChanged', { Mode: mode }); }
  } });
  registry.register('ParallaxView', { create: context => makeElement(context),
    render: (context, node, element) => context.content(element, node.properties.Child) });
  registry.register('ScrollBar', {
    create: context => makeElement(context, 'input', { type: 'range', 'aria-label': 'Scroll position' }),
    render(context, node, element) {
      element.min = node.properties.Minimum ?? 0;
      element.max = node.properties.Maximum ?? 0;
      element.value = node.properties.Value ?? 0;
      element.step = 'any';
      element.style.writingMode = node.properties.Orientation === 1 ? '' : 'vertical-lr';
    },
    events: { input(context, node, element) {
      const value = Number(element.value);
      node.properties.Value = value;
      context.emit(node, 'Scrolling', { NewValue: value, InteractionKind: 'Click' });
      context.emit(node, 'Scroll', { NewValue: value, ScrollEventType: 'ThumbTrack' });
    } }
  });
}
