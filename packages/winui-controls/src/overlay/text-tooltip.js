import { overlayManager } from './index.js';
import { setTooltipDescription } from './tooltip-description.js';

/** A text tooltip has a timed lifetime and ARIA ownership without moving keyboard focus. */
export function attachTextToolTip(context, target, text, { delay = 500, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const manager = overlayManager(context);
  const element = context.document.createElement('div');
  const identity = 'sf-tooltip-' + (target.dataset.sfId ?? context.host.nextTooltipId ?? 0);
  context.host.nextTooltipId = (context.host.nextTooltipId ?? 0) + 1;
  element.id = identity + '-' + context.host.nextTooltipId;
  element.setAttribute('role', 'tooltip');
  element.textContent = text;
  Object.assign(element.style, { padding: '6px 10px', maxWidth: '320px', border: '1px solid CanvasText',
    borderRadius: '4px', background: 'Canvas', color: 'CanvasText', pointerEvents: 'none' });
  let timer = null;
  let entry = null;
  let disposed = false;
  const description = () => setTooltipDescription(target, element.id, !!entry);
  const hide = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (entry) manager.dismiss(entry);
    entry = null;
    description();
  };
  const show = () => {
    hide();
    if (disposed || !text) return;
    timer = schedule(() => {
      timer = null;
      if (disposed) return;
      entry = manager.show(element, { id: element.id, anchor: target, lightDismiss: true, focus: false });
      entry.events.on('Closed', () => { entry = null; description(); });
      description();
    }, delay);
  };
  const key = event => { if (event.key === 'Escape') hide(); };
  for (const name of ['pointerenter', 'focusin']) target.addEventListener(name, show);
  for (const name of ['pointerleave', 'focusout', 'pointerdown']) target.addEventListener(name, hide);
  target.addEventListener('keydown', key);
  return { dispose() {
    disposed = true;
    hide();
    for (const name of ['pointerenter', 'focusin']) target.removeEventListener(name, show);
    for (const name of ['pointerleave', 'focusout', 'pointerdown']) target.removeEventListener(name, hide);
    target.removeEventListener('keydown', key);
    element.remove();
  } };
}
