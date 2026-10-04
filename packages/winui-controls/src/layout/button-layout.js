import { contentLayout } from './border-viewbox.js';
import { rect, insets, innerSize, thickness } from './geometry.js';

/** Content alignment remains independent of the button's position in its parent's layout slot. */
export const buttonLayout = {
  measure: contentLayout.measure,
  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const content = innerSize(finalSize, inset);
    const horizontal = context.properties.HorizontalContentAlignment ?? 1;
    const vertical = context.properties.VerticalContentAlignment ?? 1;
    for (const id of context.children) {
      const state = context.state(id);
      const margin = thickness(state.node.properties.Margin);
      const desiredWidth = state.unclippedSize.width + margin.left + margin.right;
      const desiredHeight = state.unclippedSize.height + margin.top + margin.bottom;
      const width = horizontal === 3 ? content.width : desiredWidth;
      const height = vertical === 3 ? content.height : desiredHeight;
      const x = horizontal === 1 ? (content.width - width) / 2 : horizontal === 2 ? content.width - width : 0;
      const y = vertical === 1 ? (content.height - height) / 2 : vertical === 2 ? content.height - height : 0;
      context.arrange(id, rect(inset.left + x, inset.top + y, Math.max(0, width), Math.max(0, height)));
    }
  }
};
