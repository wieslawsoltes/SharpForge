import { size, rect } from '../layout/geometry.js';
import { textCommandLabels } from './text-command.js';
import { commandIds, commandDesired, arrangeCommand, behaviorPart } from './layout-parts.js';

export const textCommandFlyoutLayout = {
  measure(context, available) {
    const labels = Object.values(textCommandLabels).map(text => context.intrinsicOf({ type: 'TextBlock',
      properties: { ...context.properties, Text: text, Content: null } }, size(Infinity, Infinity)));
    const rowHeight = Math.max(32, ...labels.map(value => value.height));
    const width = Math.max(160, ...labels.map(value => value.width + 32));
    const ids = [...commandIds(context, 'PrimaryCommands'), ...commandIds(context, 'SecondaryCommands')];
    const custom = ids.map(id => ({ id, size: commandDesired(context, id) }));
    for (const child of context.children) context.measure(child, available);
    context.data.textCommandLayout = { rowHeight, rows: labels.length, custom, part: behaviorPart(context) };
    return size(Math.max(width, ...custom.map(item => item.size.width)),
      rowHeight * labels.length + custom.reduce((sum, item) => sum + item.size.height, 0));
  },
  arrange(context, finalSize) {
    for (const child of context.children) context.arrange(child, rect(0, 0, finalSize.width, finalSize.height));
    const data = context.data.textCommandLayout;
    if (!data) return;
    if (data.part) context.arrange(data.part, rect(0, 0, finalSize.width, finalSize.height));
    let y = data.rowHeight * data.rows;
    for (const item of data.custom) {
      arrangeCommand(context, item.id, { x: 0, y, width: finalSize.width, height: item.size.height, hidden: false });
      y += item.size.height;
    }
  }
};
