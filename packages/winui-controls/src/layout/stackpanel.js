import { size, rect, finite, insets, innerSize, addInsets } from './geometry.js';

export const stackPanelLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const content = innerSize(available, inset);
    const horizontal = context.properties.Orientation === 1 || context.properties.Orientation === 'Horizontal';
    const constraint = horizontal ? size(Infinity, content.height) : size(content.width, Infinity);
    const spacing = Math.max(0, finite(context.properties.Spacing));
    let main = 0;
    let cross = 0;
    let count = 0;
    for (const child of context.children) {
      const desired = context.measure(child, constraint);
      if (context.resolve(child)?.properties?.Visibility === 1) continue;
      main += horizontal ? desired.width : desired.height;
      cross = Math.max(cross, horizontal ? desired.height : desired.width);
      count++;
    }
    main += spacing * Math.max(0, count - 1);
    return addInsets(horizontal ? size(main, cross) : size(cross, main), inset);
  },

  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const content = innerSize(finalSize, inset);
    const horizontal = context.properties.Orientation === 1 || context.properties.Orientation === 'Horizontal';
    const spacing = Math.max(0, finite(context.properties.Spacing));
    let offset = 0;
    for (const child of context.children) {
      const desired = context.state(child).desiredSize;
      const slot = horizontal ? rect(inset.left + offset, inset.top, desired.width, content.height)
        : rect(inset.left, inset.top + offset, content.width, desired.height);
      context.arrange(child, slot);
      if (context.resolve(child)?.properties?.Visibility !== 1) offset += (horizontal ? desired.width : desired.height) + spacing;
    }
  }
};
