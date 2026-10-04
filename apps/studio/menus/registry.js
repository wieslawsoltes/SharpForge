function validateItems(items) {
  if (!Array.isArray(items)) throw new TypeError('Menu items must be an array');
  for (const item of items) {
    if (item === null) continue;
    if (Array.isArray(item)) {
      if (typeof item[0] !== 'string' || !['string', 'function'].includes(typeof item[1])) {
        throw new TypeError('Malformed menu item');
      }
    } else if (!item || typeof item.label !== 'string') throw new TypeError('Malformed menu item');
  }
}

const copyItems = items => items.map(item => Array.isArray(item) ? [...item] : item && {...item});
const copyTopMenu = ({id, title, mnemonic, before, commands}) => ({
  id, title, mnemonic, ...(before === undefined ? {} : {before}), commands: [...commands]
});

function topMenuDescriptor(menu) {
  const fields = ['id', 'title', 'mnemonic', 'before', 'commands'];
  if (!menu || typeof menu !== 'object' || Object.keys(menu).some(key => !fields.includes(key)) ||
    typeof menu.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(menu.id) ||
    typeof menu.title !== 'string' || !menu.title.trim() ||
    typeof menu.mnemonic !== 'string' || !/^[a-z0-9]$/.test(menu.mnemonic) ||
    (menu.before !== undefined && (typeof menu.before !== 'string' || !/^[a-z][a-z0-9-]*$/.test(menu.before))) ||
    !Array.isArray(menu.commands) || !menu.commands.length || menu.commands.length > 256 ||
    [...menu.commands].some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]+$/.test(id)) ||
    new Set(menu.commands).size !== menu.commands.length) {
    throw new TypeError('Top menus require a title, mnemonic and distinct command IDs');
  }
  return copyTopMenu(menu);
}

/** Register contextual items and command-only top-menu snapshots; returned disposers are idempotent. */
export function createMenuRegistry() {
  const menus = new Map();
  const topMenus = new Map();
  return {
    registerMenu(id, items) {
      if (typeof id !== 'string' || !id) throw new TypeError('Invalid menu id');
      if (typeof items !== 'function') validateItems(items);
      const entry = typeof items === 'function' ? items : copyItems(items);
      const list = menus.get(id) ?? [];
      list.push(entry);
      menus.set(id, list);
      return () => {
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        if (!list.length && menus.get(id) === list) menus.delete(id);
      };
    },
    items(id, ...args) {
      const items = (menus.get(id) ?? []).flatMap(entry => typeof entry === 'function' ? entry(...args) : entry);
      validateItems(items);
      return copyItems(items);
    },
    registerTopMenu(menu) {
      const entry = topMenuDescriptor(menu);
      if (topMenus.has(entry.id)) throw new Error('Duplicate top menu ' + entry.id);
      topMenus.set(entry.id, entry);
      return () => { if (topMenus.get(entry.id) === entry) topMenus.delete(entry.id); };
    },
    topMenus() { return [...topMenus.values()].map(copyTopMenu); },
    dispose() { menus.clear(); topMenus.clear(); }
  };
}
