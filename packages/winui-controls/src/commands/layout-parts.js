import { size, rect } from '../layout/geometry.js';

export const referenceId = value => typeof value === 'string' ? value : value?.$ref ?? value?.id ?? null;

export function behaviorPart(context) {
  const pending = [...context.children], visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    if (visited.size >= 1000) throw new RangeError('SFUI1649: Command template exceeds its node budget');
    visited.add(id);
    const state = context.state(id);
    if (!state) continue;
    if (state.node.properties.Name === 'PART_BehaviorRoot') return id;
    pending.push(...state.children);
  }
  return null;
}

export function commandIds(context, property) {
  const values = context.node.collections[property] ?? [];
  if (values.length > 10_000) throw new RangeError('SFUI1654: Command collection exceeds its item budget');
  return values.map(referenceId).filter(id => id && context.state(id));
}

/** Hidden overflow commands keep their last natural size without becoming active hit targets. */
export function commandDesired(context, id, available = size(Infinity, Infinity)) {
  const state = context.state(id);
  if (!state) return size();
  const intrinsic = context.intrinsicOf(state.node, available);
  const desired = state.data.commandHidden ? state.data.commandNaturalSize ?? intrinsic : context.measure(id, available);
  const separator = /(?:MenuFlyout|AppBar)Separator$/.test(state.node.type);
  const result = size(Math.max(separator ? 12 : 40, desired.width, intrinsic.width),
    Math.max(separator ? 8 : 32, desired.height, intrinsic.height));
  state.data.commandNaturalSize = result;
  return result;
}

export function arrangeCommand(context, id, slot) {
  const state = context.state(id);
  if (!state) return;
  context.arrange(id, rect(slot.x, slot.y, slot.width, slot.height));
  state.data.commandHidden = !!slot.hidden;
  if (slot.hidden) state.data.clip = rect(0, 0, 0, 0);
  else if (state.data.commandClip) delete state.data.clip;
  state.data.commandClip = !!slot.hidden;
}

export function commandTemplateChildren(context, owner, part) {
  if (part.properties.Name !== 'PART_BehaviorRoot') return undefined;
  const primary = owner.collections.PrimaryCommands?.length ? owner.collections.PrimaryCommands : owner.collections.Children ?? [];
  const values = [owner.properties.Content, ...primary,
    ...(owner.collections.SecondaryCommands ?? [])];
  return values.map(referenceId).filter(id => id && context.nodes.has(id));
}

export function menuTemplateChildren(context, owner, part) {
  if (part.properties.Name !== 'PART_BehaviorRoot') return undefined;
  return (owner.collections.Items ?? []).map(referenceId).filter(id => id && context.nodes.has(id));
}
