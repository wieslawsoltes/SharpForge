import { createPart, stateFor } from '../policy/events.js';
import { renderIconSource } from '../icons/index.js';
import { teachingTipPlacement } from './placement.js';

/** Tail geometry follows the same placement as the root-relative overlay anchor. */
export function teachingTipTail({ width, height, placement, targeted, visibility = 0 }) {
  const visible = visibility === 1 || visibility === 'Visible'
    || visibility !== 2 && visibility !== 'Collapsed' && targeted;
  const side = placement.startsWith('Left') ? 'right' : placement.startsWith('Right') ? 'left'
    : placement.startsWith('Bottom') ? 'top' : 'bottom';
  return { visible, side, x: side === 'left' ? -5 : side === 'right' ? width - 5 : Math.max(0, width / 2 - 5),
    y: side === 'top' ? -5 : side === 'bottom' ? height - 5 : Math.max(0, height / 2 - 5) };
}

export function renderTeachingTipChrome(context, node, element) {
  const state = stateFor(context, node, 'teaching-tip-chrome', () => ({
    icon: createPart(context.document, 'span', 'teaching-tip-icon'), tail: createPart(context.document, 'span', 'teaching-tip-tail') }));
  state.icon.hidden = !node.properties.IconSource;
  if (node.properties.IconSource) renderIconSource(context, node.properties.IconSource, state.icon);
  state.icon.style.marginInlineEnd = '8px';
  element.firstElementChild.prepend(state.icon);
  const entry = context.services.overlays?.entries.find(value => value.id === node.id);
  const targeted = !!node.properties.Target || !!entry?.anchor;
  const geometry = teachingTipTail({ width: element.clientWidth, height: element.clientHeight,
    placement: entry?.resolvedPlacement ?? teachingTipPlacement(node.properties.PreferredPlacement ?? 0, targeted), targeted,
    visibility: node.properties.TailVisibility ?? 0 });
  state.tail.hidden = !geometry.visible || node.properties.IsTailVisible === false;
  state.tail.setAttribute('aria-hidden', 'true');
  Object.assign(state.tail.style, { position: 'absolute', width: '10px', height: '10px', left: geometry.x + 'px', top: geometry.y + 'px',
    background: 'inherit', border: '1px solid currentColor', transform: 'rotate(45deg)', pointerEvents: 'none' });
  element.append(state.tail);
}
