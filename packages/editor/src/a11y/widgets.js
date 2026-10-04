/** Attach labelled dialog semantics, focus containment and Escape restoration to an editor widget. */
export function accessibleWidget(element, {label, editor, role = 'dialog', trapFocus = true, close = null} = {}) {
  element.setAttribute('role', role);
  if (label) element.setAttribute('aria-label', label);
  const previousFocus = element.ownerDocument.activeElement;
  const listener = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close?.();
      const target = previousFocus?.isConnected ? previousFocus : editor.input;
      target.focus();
      return;
    }
    if (event.key !== 'Tab' || !trapFocus) return;
    const items = Array.from(element.querySelectorAll('button:not([disabled]),input:not([disabled]),select,[tabindex="0"]'));
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && element.ownerDocument.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && element.ownerDocument.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  element.addEventListener('keydown', listener);
  return () => element.removeEventListener('keydown', listener);
}
