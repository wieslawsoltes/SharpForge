import {prepareUICommand, isPrivateUIProperty, publicUIProperties} from '@sharpforge/winui-properties';
import {ManagedFault} from '../heap.js';

function referenceFor(platform, id) {
  const [h, g] = String(id).split(':').map(Number);
  const reference = {h, g};
  platform.record(reference);
  return reference;
}

/** Only the explicit private callback receives a password; ordinary command observers receive redacted data. */
export function deliverUICommand(platform, command) {
  const prepared = prepareUICommand(command, id => platform.record(referenceFor(platform, id)).type);
  if (prepared.command) platform.options.onUICommand?.(prepared.command);
  for (const value of prepared.privateValues) platform.options.onPrivateUIValue?.(value.id, value.property, value.value);
  if (!command.snapshot?.nodes) return;
  for (const node of command.snapshot.nodes) {
    if (!isPrivateUIProperty(node.type, 'Password')) continue;
    const reference = referenceFor(platform, node.id);
    const value = platform.native(platform.get(reference, 'Password', ''));
    platform.options.onPrivateUIValue?.(node.id, 'Password', value);
  }
}

/** Accept bounded private edits only from a visible, enabled password control. */
export function dispatchPrivateInput(platform, id, property, value) {
  const reference = referenceFor(platform, id);
  const type = platform.record(reference).type;
  if (!isPrivateUIProperty(type, property) || property !== 'Password' || typeof value !== 'string' || value.length > 1_048_576) {
    throw new ManagedFault('ArgumentException', 'Invalid private UI input');
  }
  if (!platform.scene().nodes.some(node => node.id === id)) throw new ManagedFault('InvalidOperationException', 'Private input target is not visible');
  if (!platform.native(platform.get(reference, 'IsEnabled', true))) return false;
  const managed = platform.managed(value, 'string');
  platform.heap.withRoots([reference, managed], () => platform.setProperty(reference, {owner: type, property}, managed));
  return true;
}

export function exportPublicProperties(platform, reference) {
  const values = {};
  const type = platform.record(reference).type;
  for (const [name, value] of platform.propertyEntries(reference)) {
    if (!name.startsWith('$') && !isPrivateUIProperty(type, name)) values[name] = platform.exportValue(value);
  }
  return publicUIProperties(type, values);
}
