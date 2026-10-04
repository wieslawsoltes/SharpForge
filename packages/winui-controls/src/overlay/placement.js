import { ControlError } from '../policy/events.js';

// Windows App SDK 1.8 FlyoutPlacementMode values; see the pinned reference links in the family profile document.
export const flyoutPlacements = Object.freeze(['Top', 'Bottom', 'Left', 'Right', 'Full', 'TopEdgeAlignedLeft',
  'TopEdgeAlignedRight', 'BottomEdgeAlignedLeft', 'BottomEdgeAlignedRight', 'LeftEdgeAlignedTop',
  'LeftEdgeAlignedBottom', 'RightEdgeAlignedTop', 'RightEdgeAlignedBottom', 'Auto']);

const teachingPlacements = ['Auto', 'Top', 'Bottom', 'Left', 'Right', 'TopEdgeAlignedLeft', 'TopEdgeAlignedRight',
  'BottomEdgeAlignedLeft', 'BottomEdgeAlignedRight', 'LeftEdgeAlignedBottom', 'LeftEdgeAlignedTop',
  'RightEdgeAlignedBottom', 'RightEdgeAlignedTop', 'Center'];

export function teachingTipPlacement(value, hasTarget = true) {
  const placement = teachingPlacements[value];
  if (!placement) throw new ControlError('SFUI1665', 'Unknown teaching-tip placement');
  return placement === 'Auto' ? hasTarget ? 'Top' : 'Bottom' : placement;
}

function flipPlacement(mode, bounds, size) {
  const side = ['Top', 'Bottom', 'Left', 'Right'].find(value => mode.startsWith(value));
  if (!side) return mode;
  const opposite = { Top: 'Bottom', Bottom: 'Top', Left: 'Right', Right: 'Left' }[side];
  const length = side === 'Top' || side === 'Bottom' ? size.height : size.width;
  return bounds[side] < length && bounds[opposite] > bounds[side]
    ? opposite + mode.slice(side.length) : mode;
}

/** CSS-pixel rectangles produce root-relative placement without observing a browser. */
export function placeOverlay({ root, anchor = root, size, placement = 'Bottom', offsets = {}, constrain = true }) {
  let mode = typeof placement === 'number' ? flyoutPlacements[placement] : placement;
  if (!flyoutPlacements.includes(mode) && mode !== 'Center') throw new ControlError('SFUI1665', 'Unknown flyout placement');
  if ([root.left, root.top, root.width, root.height, anchor.left, anchor.top, size.width, size.height,
    offsets.x ?? 0, offsets.y ?? 0].some(value => !Number.isFinite(value))) {
    throw new ControlError('SFUI1665', 'Overlay placement requires finite bounds and offsets');
  }
  const width = Math.max(0, size.width), height = Math.max(0, size.height);
  const leftEdge = anchor.left - root.left, topEdge = anchor.top - root.top;
  const anchorWidth = anchor.width ?? anchor.right - anchor.left, anchorHeight = anchor.height ?? anchor.bottom - anchor.top;
  if (![anchorWidth, anchorHeight].every(Number.isFinite)) {
    throw new ControlError('SFUI1665', 'Overlay anchor dimensions must be finite');
  }
  if (mode === 'Auto') mode = root.height - topEdge - anchorHeight >= height ? 'Bottom' : topEdge >= height ? 'Top' : 'Full';
  if (constrain) {
    mode = flipPlacement(mode, {
      Top: topEdge + (offsets.y ?? 0), Bottom: root.height - topEdge - anchorHeight - (offsets.y ?? 0),
      Left: leftEdge + (offsets.x ?? 0), Right: root.width - leftEdge - anchorWidth - (offsets.x ?? 0)
    }, { width, height });
  }
  let left = leftEdge + (anchorWidth - width) / 2, top = topEdge + (anchorHeight - height) / 2;
  if (mode === 'Full') { left = (root.width - width) / 2; top = (root.height - height) / 2; }
  else if (mode.startsWith('Top')) top = topEdge - height;
  else if (mode.startsWith('Bottom')) top = topEdge + anchorHeight;
  else if (mode.startsWith('Left')) left = leftEdge - width;
  else if (mode.startsWith('Right')) left = leftEdge + anchorWidth;
  if (mode.endsWith('AlignedLeft')) left = leftEdge;
  else if (mode.endsWith('AlignedRight')) left = leftEdge + anchorWidth - width;
  else if (mode.endsWith('AlignedTop')) top = topEdge;
  else if (mode.endsWith('AlignedBottom')) top = topEdge + anchorHeight - height;
  left += offsets.x ?? 0; top += offsets.y ?? 0;
  if (constrain) {
    left = Math.max(0, Math.min(Math.max(0, root.width - width), left));
    top = Math.max(0, Math.min(Math.max(0, root.height - height), top));
  }
  return { left, top, placement: mode };
}
