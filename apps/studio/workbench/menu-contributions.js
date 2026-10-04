const descriptorFields = new Set(['id', 'title', 'mnemonic', 'before', 'commands']);

function copyDescriptor(menu) {
  if (!menu || typeof menu !== 'object' || Object.keys(menu).some(key => !descriptorFields.has(key)) ||
    typeof menu.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(menu.id) ||
    typeof menu.title !== 'string' || !menu.title.trim() ||
    typeof menu.mnemonic !== 'string' || !/^[a-z0-9]$/.test(menu.mnemonic) ||
    (menu.before !== undefined && (typeof menu.before !== 'string' || !/^[a-z][a-z0-9-]*$/.test(menu.before))) ||
    !Array.isArray(menu.commands) || !menu.commands.length || menu.commands.length > 256 ||
    [...menu.commands].some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]+$/.test(id)) ||
    new Set(menu.commands).size !== menu.commands.length) {
    throw new TypeError('Menu contributions require a title, mnemonic and distinct command IDs');
  }
  return {id: menu.id, title: menu.title, mnemonic: menu.mnemonic, commands: [...menu.commands], before: menu.before};
}

/** Merge at most 64 command-only contributions; before anchors name base menus, and inputs remain unchanged. */
export function mergeMenuContributions(base, contributions = []) {
  if (!Array.isArray(contributions) || contributions.length > 64) throw new RangeError('Too many menu contributions');
  const anchors = new Set(base.map(menu => menu.id));
  const identifiers = new Set(anchors);
  const mnemonics = new Set(base.map(menu => menu.mnemonic));
  const additions = Array.from(contributions, copyDescriptor);
  for (const menu of additions) {
    if (identifiers.has(menu.id)) throw new Error('Duplicate menu ' + menu.id);
    if (mnemonics.has(menu.mnemonic)) throw new Error('Duplicate menu mnemonic ' + menu.mnemonic);
    if (menu.before !== undefined && !anchors.has(menu.before)) throw new Error('Unknown menu anchor ' + menu.before);
    identifiers.add(menu.id);
    mnemonics.add(menu.mnemonic);
  }
  const result = [...base];
  for (const menu of additions) {
    const index = menu.before === undefined ? result.length : result.findIndex(item => item.id === menu.before);
    result.splice(index, 0, menu);
  }
  return result;
}
