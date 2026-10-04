import { ControlError } from '../policy/events.js';
import { viewportSource } from './viewport-source.js';

export function sourceItems(context, node, property = 'Items') {
  const viewport = property === 'Items' ? viewportSource(node) : null;
  if (viewport) return viewport;
  const source = node.properties.ItemsSource ?? node.properties[property + 'Source'];
  if (Array.isArray(source)) return source;
  if (source?.$ref) {
    const model = context.nodes.get(source.$ref);
    if (Array.isArray(model?.items)) return model.items;
    if (Array.isArray(model?.collections?.Items)) return model.collections.Items;
  }
  return node.collections?.[property] ?? [];
}

export function itemText(context, item, path = '') {
  let value = item?.$ref ? context.nodes.get(item.$ref)?.properties : item;
  if (path) for (const part of path.split('.')) value = value?.[part];
  else if (value && typeof value === 'object') value = value.Content ?? value.Text ?? value.Header ?? value.DisplayName ?? '';
  return value == null ? '' : String(value);
}

export function indexOfItem(items, item) {
  if (items?.records) {
    for (const [index, record] of items.records) if (record.item === item || item?.$ref && record.item?.$ref === item.$ref) return index;
    return -1;
  }
  return item?.$ref ? items.findIndex(value => value?.$ref === item.$ref) : items.indexOf(item);
}

export function itemAt(items, index) { return items?.getAt ? items.getAt(index) : items?.[index]; }

/** Zero is auto only on the new list/tree profile property; released panel defaults are untouched. */
export function defaultItemHeight(context, node) {
  const explicit = node.properties.ItemHeight;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return context.services?.environment?.TouchMode ? 40 : 32;
}

export function navigationIndex(key, current, count, { columns = 1, pageSize = 10, rtl = false } = {}) {
  if (!count) return -1;
  const horizontal = rtl ? -1 : 1;
  const steps = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: horizontal, ArrowLeft: -horizontal,
    PageDown: pageSize, PageUp: -pageSize };
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return Object.hasOwn(steps, key) ? Math.max(0, Math.min(count - 1, current + steps[key])) : current;
}

/** Uniform-height virtualization returns an overscanned interval without constructing every container. */
export function visibleItemRange(count, { scroll = 0, extent = 320, itemSize = 32, overscan = 4, columns = 1 } = {}) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new ControlError('SFUI1603', 'Invalid item count');
  if (!(itemSize > 0) || !Number.isFinite(itemSize)) throw new ControlError('SFUI1605', 'A positive item extent is required');
  const startRow = Math.max(0, Math.floor(scroll / itemSize) - overscan);
  const endRow = Math.ceil((Math.max(0, scroll) + Math.max(0, extent)) / itemSize) + overscan;
  return { first: Math.min(count, startRow * columns), last: Math.min(count, endRow * columns),
    before: startRow * itemSize, total: Math.ceil(count / columns) * itemSize };
}
