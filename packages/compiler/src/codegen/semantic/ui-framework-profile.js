const callbackFamilies = Object.freeze([
  'Microsoft.UI.', 'Microsoft.Graphics.Canvas.', 'Windows.Foundation.', 'Windows.UI.', 'SharpForge.UI.',
  'System.ComponentModel.', 'System.Collections.ObjectModel.', 'System.Collections.Specialized.', 'System.Windows.Input.'
]);
const referenceFamilies = Object.freeze([
  'Microsoft.UI.', 'Microsoft.Graphics.Canvas.', 'Windows.Foundation.', 'Windows.UI.', 'SharpForge.UI.'
]);

/** Callback admission requires an existing closed registry type in an explicitly supported UI API family. */
export function isRegisteredUICallbackOwner(bridge, name) {
  return typeof name === 'string' && bridge.types.has(name) && callbackFamilies.some(prefix => name.startsWith(prefix));
}

/** Registered UI reference conversions use checked runtime type tables; value types and arbitrary source bases are excluded. */
export function isRegisteredUIReference(bridge, name) {
  if (typeof name !== 'string' || !referenceFamilies.some(prefix => name.startsWith(prefix))) return false;
  const type = bridge.types.get(name);
  return !!type && !['value', 'enum', 'delegate', 'static'].includes(type.typeKind ?? type.kind) && type.base !== 'System.ValueType';
}
