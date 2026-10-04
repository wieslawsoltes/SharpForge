import { size, rect, insets, innerSize, addInsets } from '../layout/geometry.js';
import { commandBarGeometry } from './geometry.js';
import { behaviorPart, commandIds, commandDesired, arrangeCommand, referenceId } from './layout-parts.js';
import { textCommandFlyoutLayout } from './text-layout.js';

function inputs(context, available) {
  const primary = commandIds(context, 'PrimaryCommands');
  if (!primary.length) primary.push(...commandIds(context, 'Children'));
  const secondary = commandIds(context, 'SecondaryCommands');
  const contentId = referenceId(context.properties.Content);
  const content = contentId && context.state(contentId) ? context.measure(contentId, available)
    : context.intrinsicOf({ ...context.node, properties: { ...context.properties, Text: context.properties.Content ?? '' } }, available);
  return { primary, secondary, content, contentId, properties: context.properties, available };
}

function geometry(context, available) {
  const values = inputs(context, available);
  return { ...commandBarGeometry(values, id => commandDesired(context, id),
    id => context.state(id).node.properties.DynamicOverflowOrder ?? 0), contentId: values.contentId };
}

export const commandBarLayout = {
  measure(context, available) {
    const inset = insets(context.node.templateRoot ? { ...context.properties, BorderThickness: 0 } : context.properties);
    const inner = innerSize(available, inset);
    for (const child of context.children) context.measure(child, inner);
    const result = geometry(context, inner);
    context.data.commandLayout = result;
    context.data.commandBehaviorPart = behaviorPart(context);
    return addInsets(size(result.width, result.height), inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.node.templateRoot ? { ...context.properties, BorderThickness: 0 } : context.properties);
    const inner = innerSize(finalSize, inset);
    const result = geometry(context, inner);
    context.data.commandLayout = result;
    for (const child of context.children) context.arrange(child, rect(inset.left, inset.top, inner.width, inner.height));
    const part = context.data.commandBehaviorPart;
    if (part) context.arrange(part, rect(0, 0, inner.width, inner.height));
    if (result.contentId && context.state(result.contentId)) {
      arrangeCommand(context, result.contentId, { ...result.content, hidden: result.hidden });
    }
    for (const [id, slot] of result.rectangles) arrangeCommand(context, id, slot);
  }
};

export function registerCommandLayouts(registry) {
  registry.register(['CommandBar', 'CommandBarFlyout'], commandBarLayout);
  registry.register('TextCommandBarFlyout', textCommandFlyoutLayout);
  return registry;
}
