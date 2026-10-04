import { GroupedItemIndex, ViewportGroupIndex } from './grouping.js';
import { createPart } from '../policy/events.js';

function groupKey(context, value, path) {
  let item = value?.$ref ? context.nodes.get(value.$ref)?.properties : value;
  for (const part of path.split('.')) item = item?.[part];
  return item;
}

export function updateGroups(context, node, state, items) {
  if (Array.isArray(items.groups)) {
    if (state.groupRecords !== items.groups) {
      state.groupRecords = items.groups;
      state.groups = new ViewportGroupIndex(items.groups, items.count);
    }
    return;
  }
  state.groupRecords = null;
  const path = node.properties.GroupKeyPath;
  if (!path) { state.groups = null; return; }
  if (state.groupSource === items && state.groupRevision === node.properties.ItemsRevision && state.groupPath === path) return;
  state.groupSource = items;
  state.groupRevision = node.properties.ItemsRevision;
  state.groupPath = path;
  state.groups = new GroupedItemIndex(items, item => groupKey(context, item, path));
}

export function renderGroupHeaders(context, node, state, element) {
  if (!state.groupLayer) {
    state.groupLayer = createPart(context.document, 'div', 'group-headers');
    state.groupLayer.style.pointerEvents = 'none';
    state.stickyHeader = createPart(context.document, 'div', 'group-sticky-header');
    Object.assign(state.stickyHeader.style, { position: 'sticky', top: '0', zIndex: '2', pointerEvents: 'none' });
  }
  const viewport = element.children[1];
  const realized = state.realized ?? [];
  const groups = state.groups;
  state.groupVisualChildren = [];
  if (!groups?.groups.length) {
    state.groupLayer.remove();
    state.stickyHeader.remove();
    return;
  }
  const visible = new Map();
  for (const item of realized) {
    const group = groups.groupAt(item.index);
    if (group?.first === item.index && item.y >= element.scrollTop) visible.set(group, item);
  }
  let emptyOffset = 0;
  for (const group of groups.groups) {
    if (group.length) continue;
    const nearby = realized.find(item => item.index >= group.first);
    visible.set(group, { y: (nearby?.y ?? 0) + emptyOffset, element: null });
    emptyOffset += 24;
  }
  const headers = [];
  for (const [group, item] of visible) {
    const header = createPart(context.document, 'div', 'group-header');
    if (group.header?.$ref) {
      context.content(header, group.header);
      state.groupVisualChildren.push(group.header.$ref);
      header.style.pointerEvents = 'auto';
    } else header.textContent = String(group.key ?? '');
    header.setAttribute('role', 'heading');
    header.setAttribute('aria-level', '2');
    Object.assign(header.style, { position: 'absolute', top: item.y + 'px', insetInlineStart: '0', fontWeight: '600' });
    if (item.element) item.element.style.paddingTop = '24px';
    headers.push(header);
  }
  context.ordered(state.groupLayer, headers);
  viewport.append(state.groupLayer);
  if (!realized.length && headers.length) {
    viewport.style.height = headers.length * 24 + 'px';
    if (state.metrics) state.metrics.ExtentHeight = headers.length * 24;
  }
  const firstVisible = realized.find(item => item.y + item.height > element.scrollTop);
  const anchor = firstVisible ? groups.groupAt(firstVisible.index) : groups.groups[0];
  const previousAnchor = state.groupAnchor;
  state.groupAnchor = anchor?.key ?? null;
  node.properties.GroupAnchor = state.groupAnchor;
  if (!Object.is(previousAnchor, state.groupAnchor)) context.emit(node, 'GroupAnchorChanged', { GroupAnchor: state.groupAnchor });
  const anchorIsInline = anchor && visible.has(anchor);
  if (anchor?.header?.$ref && !anchorIsInline) {
    context.content(state.stickyHeader, anchor.header);
    state.groupVisualChildren.push(anchor.header.$ref);
    state.stickyHeader.style.pointerEvents = 'auto';
  } else state.stickyHeader.textContent = anchor?.header ? '' : String(state.groupAnchor ?? '');
  state.stickyHeader.hidden = node.properties.AreStickyGroupHeadersEnabled === false;
  const header = element.children[0];
  header.hidden = false;
  header.style.position = 'sticky';
  header.style.top = '0';
  header.style.zIndex = '2';
  header.append(state.stickyHeader);
}
