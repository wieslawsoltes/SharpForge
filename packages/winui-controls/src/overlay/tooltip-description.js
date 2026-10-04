/** Preserve unrelated descriptions while a tooltip owns one accessible-description token. */
export function setTooltipDescription(target, identity, visible) {
  const values = new Set((target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
  if (visible) values.add(identity);
  else values.delete(identity);
  if (values.size) target.setAttribute('aria-describedby', [...values].join(' '));
  else target.removeAttribute('aria-describedby');
}
