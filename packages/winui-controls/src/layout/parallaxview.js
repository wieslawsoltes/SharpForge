import { contentLayout } from './border-viewbox.js';
import { parallaxOffset } from './twopaneview.js';
import { finite } from './geometry.js';

export const parallaxLayout = {
  measure: contentLayout.measure,
  arrange(context, finalSize) {
    contentLayout.arrange(context, finalSize);
    const source = context.properties.Source?.$ref;
    const scroll = source ? context.state(source)?.data.scroll : null;
    if (!scroll) { context.data.childTransform = [1, 0, 0, 1, 0, 0]; return; }
    const x = parallaxOffset(scroll.horizontalOffset, scroll.extent.width, scroll.viewport.width / scroll.zoomFactor,
      finite(context.properties.HorizontalShift), context.properties.IsHorizontalShiftClamped !== false);
    const y = parallaxOffset(scroll.verticalOffset, scroll.extent.height, scroll.viewport.height / scroll.zoomFactor,
      finite(context.properties.VerticalShift), context.properties.IsVerticalShiftClamped !== false);
    context.data.childTransform = [1, 0, 0, 1, x, y];
  }
};
