import { ControlError, controlName } from '../policy/events.js';
import { sourceItems, itemText, itemAt } from '../items/item-source.js';

/** Flattens only expanded branches; paths distinguish repeated references. */
export function navigationEntries(context, owner) {
  const result = [];
  const ancestors = new Set();
  let visited = 0;
  const visit = (node, property, depth, prefix, parentKey) => {
    if (depth > 128) throw new ControlError('SFUI1679', 'Navigation hierarchy exceeds its depth budget');
    const items = sourceItems(context, node, property);
    for (let index = 0; index < items.length; index++) {
      if (++visited > 10_000) throw new ControlError('SFUI1679', 'Navigation hierarchy exceeds its visible item budget');
      const value = itemAt(items, index);
      const metadata = value?.$ref ? context.nodes.get(value.$ref) : null;
      const key = prefix + index;
      const kind = metadata ? controlName(metadata) : 'NavigationViewItem';
      const properties = metadata?.properties ?? {};
      const children = metadata ? sourceItems(context, metadata, 'MenuItems').length : 0;
      const entry = { key, parentKey, depth, value, node: metadata, index, properties, kind, children,
        text: itemText(context, properties.Content ?? value), selectable: !kind.endsWith('Header') && !kind.endsWith('Separator') };
      result.push(entry);
      if (!children || !properties.IsExpanded) continue;
      if (ancestors.has(metadata.id)) throw new ControlError('SFUI1679', 'Navigation hierarchy contains a cycle');
      ancestors.add(metadata.id);
      visit(metadata, 'MenuItems', depth + 1, key + '.', key);
      ancestors.delete(metadata.id);
    }
  };
  visit(owner, 'MenuItems', 0, 'menu:', null);
  visit(owner, 'FooterMenuItems', 0, 'footer:', null);
  if (owner.properties.IsSettingsVisible !== false) result.push({ key: 'settings', parentKey: null, depth: 0,
    value: owner.properties.SettingsItem ?? null, node: null, index: -1, properties: {}, kind: 'NavigationViewItem',
    children: 0, text: 'Settings', selectable: true, settings: true });
  return result;
}
