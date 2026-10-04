import { frameworkType } from '@sharpforge/framework';

const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

function templateReference(host, command, property, value) {
  if (!identity(command.id) || value !== null && !identity(value)) throw new TypeError('Invalid template identity');
  const node = host.nodes.get(command.id);
  if (node) node[property] = value;
}

function removeSceneNode(host, command) {
  const id = command.id;
  if (!identity(id)) throw new TypeError('Invalid scene identity');
  const element = host.elements.get(id);
  const surface = host.surfaces.get(id);
  const failures = [];
  try { if (element) host.resizeObserver?.unobserve(element); } catch (error) { failures.push(error); }
  try { element?.remove(); } catch (error) { failures.push(error); }
  try { surface?.dispose(); } catch (error) { failures.push(error); }
  host.elements.delete(id);
  host.surfaces.delete(id);
  host.layouts.delete(id);
  host.nodes.delete(id);
  host.windows = host.windows.filter(value => value !== id);
  host.pendingFlyouts = host.pendingFlyouts.filter(value => value.id !== id && value.anchor !== id);
  for (const [flyout, anchor] of host.openFlyouts) {
    if (flyout !== id && anchor !== id) continue;
    const popup = host.elements.get(flyout);
    if (popup) popup.hidden = true;
    host.openFlyouts.delete(flyout);
  }
  for (const node of host.nodes.values()) {
    if (node.templateRoot === id) node.templateRoot = null;
    if (node.templateOwner === id) node.templateOwner = null;
  }
  if (failures.length) throw new AggregateError(failures, 'Scene node removal cleanup failed');
}

const operations = new Map([
  ['reset', (host, command) => host.load(command.snapshot)],
  ['create', (host, command) => {
    if (typeof command.id !== 'string' || !frameworkType(command.type)) throw new TypeError('Unknown UI object');
    host.nodes.set(command.id, { id: command.id, type: command.type,
      properties: { ...command.properties }, events: [], collections: {} });
  }],
  ['set', (host, command, node) => { if (node) node.properties[command.property] = command.value; }],
  ['event', (host, command, node) => {
    if (!node) return;
    const events = new Set(node.events);
    if (command.enabled) events.add(command.event);
    else events.delete(command.event);
    node.events = [...events];
  }],
  ['collection', (host, command, node) => { if (node) node.collections[command.property] = [...command.items]; }],
  ['draw', (host, command, node) => { if (node) node.drawing = command.commands; }],
  ['activate', (host, command) => {
    if (command.snapshot) host.merge(command.snapshot);
    if (!host.windows.includes(command.id)) host.windows.push(command.id);
  }],
  ['close', (host, command) => { host.windows = host.windows.filter(id => id !== command.id); }],
  ['focus', (host, command) => queueMicrotask(() => {
    const element = host.elements.get(command.id);
    (element?.querySelector('input,textarea,select,button') ?? element)?.focus();
  })],
  ['flyout', (host, command) => host.pendingFlyouts.push(command)],
  ['template', (host, command) => templateReference(host, command, 'templateRoot', command.root)],
  ['templateOwner', (host, command) => templateReference(host, command, 'templateOwner', command.owner)],
  ['remove', removeSceneNode]
]);

/** The released DOM host's command adapter; template changes retain existing scene and element identities. */
export function applySceneCommands(host, commands) {
  if (!Array.isArray(commands)) commands = [commands];
  if (commands.length > 20000) throw new RangeError('UI command batch limit');
  for (const command of commands) {
    if (!command || typeof command.op !== 'string') throw new TypeError('Invalid UI command');
    operations.get(command.op)?.(host, command, host.nodes.get(command.id));
    if (host.nodes.size > 20000) throw new RangeError('WinUI object limit');
  }
  host.schedule();
}
