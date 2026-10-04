const contentTemplates = new Set(['Button', 'ToggleButton', 'HyperlinkButton', 'AppBarButton', 'AppBarToggleButton',
  'ContentControl', 'Page', 'Frame', 'NavigationViewItem', 'TabViewItem', 'PivotItem', 'CheckBox', 'RadioButton',
  'ToggleSwitch', 'DropDownButton', 'SplitButton', 'ToggleSplitButton', 'RepeatButton', 'Expander', 'AppBarElementContainer']);

function shortName(node) {
  return node.type.slice(node.type.lastIndexOf('.') + 1);
}

function stateForTemplate(context, node, renderer) {
  const state = context.getState(node);
  if (!state.familyTemplate) {
    const nativeNode = { ...node, templateRoot: null };
    const root = renderer.create?.(context, nativeNode) ?? context.document.createElement('div');
    root.dataset.part ??= 'behavior-root';
    state.familyTemplate = { root, nativeNode, parts: new Map(), templateId: null };
  }
  Object.assign(state.familyTemplate.nativeNode, node, { templateRoot: null });
  return state.familyTemplate;
}

function nativeTarget(context, node, element, renderer) {
  if (!node.templateRoot) return { node, element };
  const state = stateForTemplate(context, node, renderer);
  return { node: state.nativeNode, element: state.root };
}

function collectTemplateParts(context, rootId) {
  const pending = [rootId];
  const visited = new Set();
  const parts = new Map();
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    if (visited.size >= 1000) throw Object.assign(new Error('Control template exceeds its visual node budget'), { code: 'SFUI1649' });
    visited.add(id);
    const node = context.nodes.get(id);
    if (!node) continue;
    if (node.properties.Name) parts.set(node.properties.Name, node.id);
    for (const property of ['Content', 'Child']) if (node.properties[property]?.$ref) pending.push(node.properties[property].$ref);
    for (const values of Object.values(node.collections)) {
      for (const value of values) if (value?.$ref) pending.push(value.$ref);
    }
  }
  return parts;
}

/** Keep native editing/virtualization behavior inside real, named managed template presenters. */
export function withFamilyTemplate(renderer) {
  const wrapped = { ...renderer, handlesTemplate: true };
  wrapped.create = (context, node) => {
    if (!node.templateRoot) return renderer.create?.(context, node) ?? context.document.createElement('div');
    stateForTemplate(context, node, renderer);
    return context.document.createElement('div');
  };
  wrapped.render = (context, node, element) => {
    const target = nativeTarget(context, node, element, renderer);
    renderer.render?.(context, target.node, target.element);
  };
  wrapped.afterRender = (context, node, element) => {
    if (!node.templateRoot) return renderer.afterRender?.(context, node, element);
    const state = stateForTemplate(context, node, renderer);
    if (state.templateId !== node.templateRoot) {
      state.parts = collectTemplateParts(context, node.templateRoot);
      state.templateId = node.templateRoot;
    }
    const root = context.host.ensure(node.templateRoot);
    context.ordered(element, root ? [root] : []);
    if (renderer.mountTemplate?.(context, node, element, state) === true) {
      renderer.afterRender?.(context, state.nativeNode, state.root);
      return;
    }
    const slot = state.parts.get('PART_BehaviorRoot');
    if (slot) {
      const presenter = context.host.ensure(slot);
      const contentRoot = context.nodes.get(slot)?.templateRoot;
      if (contentRoot && contentTemplates.has(shortName(node))) {
        state.nativeNode.properties = { ...node.properties, Content: { $ref: contentRoot } };
        try { renderer.render?.(context, state.nativeNode, state.root); }
        finally { state.nativeNode.properties = node.properties; }
      }
      context.ordered(presenter, [state.root]);
      state.root.style.width = '100%';
      state.root.style.height = '100%';
      state.root.style.boxSizing = 'border-box';
    } else if (!contentTemplates.has(shortName(node))) {
      throw Object.assign(new Error(`${shortName(node)} requires template part PART_BehaviorRoot`), { code: 'SFUI1649' });
    }
    renderer.afterRender?.(context, state.nativeNode, state.root);
  };
  wrapped.events = Object.fromEntries(Object.entries(renderer.events ?? {}).map(([name, callback]) =>
    [name, (context, node, element, event) => {
      const target = nativeTarget(context, node, element, renderer);
      return callback(context, target.node, target.element, event);
    }]));
  for (const name of ['invoke', 'setPrivateValue', 'getPrivateValue']) {
    if (!renderer[name]) continue;
    wrapped[name] = (context, node, element, ...args) => {
      const target = nativeTarget(context, node, element, renderer);
      return renderer[name](context, target.node, target.element, ...args);
    };
  }
  wrapped.automationElement = (context, node, element) => {
    const target = nativeTarget(context, node, element, renderer);
    const semantic = renderer.automationElement ?? renderer.semanticElement;
    return semantic?.(context, target.node, target.element) ?? target.element;
  };
  wrapped.dispose = (context, node, element) => {
    const target = nativeTarget(context, node, element, renderer);
    renderer.dispose?.(context, target.node, target.element);
    const state = context.getState(node).familyTemplate;
    state?.root.remove();
    delete context.getState(node).familyTemplate;
  };
  return wrapped;
}
