import {canonicalType} from '@sharpforge/framework';

const reserved = new Set(['common', 'all', 'project', 'recent']);
const typeName = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate saved tab metadata without claiming that a project's types are currently available. */
export function normalizeToolboxTabs(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length > 16) {
    throw new RangeError('Toolbox custom tab limit exceeded');
  }
  const ids = new Set(reserved);
  const tabs = value.tabs.map(tab => {
    if (!tab || !/^[a-z][a-z0-9-]{0,39}$/.test(tab.id) || ids.has(tab.id)) throw new TypeError('Toolbox tab id must be unique');
    ids.add(tab.id);
    if (typeof tab.label !== 'string' || !tab.label.trim() || tab.label.length > 80) throw new RangeError('Toolbox custom tab label limit exceeded');
    if (!Array.isArray(tab.types) || tab.types.length > 512) throw new RangeError('Toolbox tab item limit exceeded');
    const types = tab.types.map(type => {
      if (typeof type !== 'string' || type.length > 512 || !typeName.test(type)) throw new TypeError('Invalid toolbox control type');
      return canonicalType(type);
    });
    return {id: tab.id, label: tab.label.trim(), types: [...new Set(types)]};
  });
  return {version: 1, tabs};
}
