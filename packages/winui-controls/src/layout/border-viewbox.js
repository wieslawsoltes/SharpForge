import { size, rect, insets, innerSize, addInsets } from './geometry.js';

export const contentLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const content = innerSize(available, inset);
    let desired = context.intrinsic(content);
    for (const child of context.children) {
      const childSize = context.measure(child, content);
      desired = size(Math.max(desired.width, childSize.width), Math.max(desired.height, childSize.height));
    }
    return addInsets(desired, inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const content = innerSize(finalSize, inset);
    for (const child of context.children) context.arrange(child, rect(inset.left, inset.top, content.width, content.height));
  }
};

/** Stretch preserves None/Fill/Uniform/UniformToFill and direction limits independently per axis. */
export function viewboxScale(desired, available, stretch = 2, direction = 0) {
  let horizontal = desired.width > 0 && Number.isFinite(available.width) ? available.width / desired.width : 1;
  let vertical = desired.height > 0 && Number.isFinite(available.height) ? available.height / desired.height : 1;
  if (!Number.isFinite(available.width)) horizontal = vertical;
  if (!Number.isFinite(available.height)) vertical = horizontal;
  if (stretch === 0 || stretch === 'None') horizontal = vertical = 1;
  else if (stretch !== 1 && stretch !== 'Fill') {
    horizontal = vertical = stretch === 3 || stretch === 'UniformToFill'
      ? Math.max(horizontal, vertical) : Math.min(horizontal, vertical);
  }
  if (direction === 1 || direction === 'UpOnly') {
    horizontal = Math.max(1, horizontal);
    vertical = Math.max(1, vertical);
  } else if (direction === 2 || direction === 'DownOnly') {
    horizontal = Math.min(1, horizontal);
    vertical = Math.min(1, vertical);
  }
  return { x: horizontal, y: vertical };
}

export const viewboxLayout = {
  measure(context, available) {
    const child = context.children[0];
    const desired = child ? context.measure(child, size(Infinity, Infinity)) : context.intrinsic(available);
    context.data.naturalSize = desired;
    const scale = viewboxScale(desired, available, context.properties.Stretch, context.properties.StretchDirection);
    return size(desired.width * scale.x, desired.height * scale.y);
  },
  arrange(context, finalSize) {
    const desired = context.data.naturalSize ?? size();
    const scale = viewboxScale(desired, finalSize, context.properties.Stretch, context.properties.StretchDirection);
    context.data.childTransform = [scale.x, 0, 0, scale.y,
      (finalSize.width - desired.width * scale.x) / 2, (finalSize.height - desired.height * scale.y) / 2];
    for (const child of context.children) context.arrange(child, rect(0, 0, desired.width, desired.height));
  }
};
