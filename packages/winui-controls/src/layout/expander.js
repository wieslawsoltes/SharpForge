import { size, rect, finite, insets, innerSize, addInsets } from './geometry.js';

function parts(context) {
  const root = context.node.templateRoot;
  if (!root) return { header: context.properties.Header?.$ref, content: context.properties.Content?.$ref, root: null, container: context.id };
  const result = { root, container: root, header: null, content: null };
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > 1000) throw new RangeError('SFUI1649: Expander template node limit');
    const state = context.state(pending[index]);
    if (!state) continue;
    const name = state.node.properties.Name;
    if (name === 'HeaderPresenter') result.header = state.id;
    if (name === 'PART_BehaviorRoot') result.content = state.id;
    if (name === 'ExpanderLayoutRoot') result.container = state.id;
    pending.push(...state.children);
  }
  if (!result.header || !result.content) throw new Error('SFUI1649: Expander requires HeaderPresenter and PART_BehaviorRoot template parts');
  return result;
}
function insetFor(context) {
  return insets(context.node.templateRoot ? { ...context.properties, BorderThickness: 0 } : context.properties);
}
function isUp(properties) {
  const direction = properties.ExpandDirection ?? 0;
  if (![0, 1, 'Down', 'Up'].includes(direction)) throw new Error('SFLAYOUT006: This Expander profile supports Up and Down directions');
  return direction === 1 || direction === 'Up';
}
function headerSize(context, available, header) {
  const measured = header ? context.measure(header, size(available.width, Infinity)) : context.intrinsicOf({ ...context.node,
    type: 'TextBlock', properties: { ...context.properties, Content: null, Text: context.properties.Header ?? '', TextWrapping: 1 } }, available);
  return size(measured.width, Math.max(finite(context.properties.HeaderHeight, 32), measured.height));
}

/** Header/content are separate slots; template ownership and browser behavior use those same slots. */
export const expanderLayout = {
  measure(context, available) {
    isUp(context.properties);
    const inset = insetFor(context), content = innerSize(available, inset), owned = parts(context);
    context.data.expanderParts = owned;
    if (owned.content) context.suppress(owned.content, !context.properties.IsExpanded);
    const header = headerSize(context, content, owned.header);
    context.data.expanderHeaderSize = header;
    let body = size();
    if (owned.content && context.properties.IsExpanded) body = context.measure(owned.content, size(content.width, Math.max(0, content.height - header.height)));
    if (owned.root) context.measure(owned.root, content);
    return addInsets(size(Math.max(header.width, body.width), header.height + body.height), inset);
  },
  arrange(context, finalSize) {
    const inset = insetFor(context), available = innerSize(finalSize, inset), owned = context.data.expanderParts ?? parts(context);
    if (owned.root) context.arrange(owned.root, rect(inset.left, inset.top, available.width, available.height));
    const container = owned.root ? context.state(owned.container).renderSize : available;
    const headerHeight = Math.min(container.height, context.data.expanderHeaderSize?.height ?? 32);
    const up = isUp(context.properties), offsetX = owned.root ? 0 : inset.left, offsetY = owned.root ? 0 : inset.top;
    const header = rect(offsetX, offsetY + (up ? container.height - headerHeight : 0), container.width, headerHeight);
    const body = rect(offsetX, offsetY + (up ? 0 : headerHeight), container.width,
      context.properties.IsExpanded ? Math.max(0, container.height - headerHeight) : 0);
    context.data.headerRect = header;
    context.data.contentRect = body;
    context.data.clip = rect(0, 0, finalSize.width, finalSize.height);
    if (owned.header) context.arrange(owned.header, header);
    if (owned.content) {
      context.arrange(owned.content, body);
      context.state(owned.content).data.clip = rect(0, 0, body.width, body.height);
    }
  }
};
