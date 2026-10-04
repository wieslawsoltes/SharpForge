import {decorateDesignerButton, designerButton} from './designer-command-buttons.js';

const preferred = new Set(['undo', 'redo', 'fit', 'preview', 'generate']);
const focusable = 'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]';

/** One command row with a keyboard-operable overflow panel; controls retain their identity. */
export class DesignerCommandBar {
  constructor(view, {modes, sync}) {
    this.view = view;
    this.panel = view.panel('designer');
    this.document = this.panel.ownerDocument;
    this.items = [];
    this.disposed = false;
    this.opened = false;
    this.create(modes, sync);
  }

  create(modes, sync) {
    const bar = this.document.createElement('div');
    bar.className = 'design-command-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Designer commands');
    const primary = this.document.createElement('div');
    primary.className = 'design-command-primary';
    if (modes) primary.append(modes);
    const overflow = this.document.createElement('div');
    overflow.className = 'design-command-overflow';
    overflow.hidden = true;
    overflow.setAttribute('role', 'dialog');
    overflow.setAttribute('aria-label', 'More designer commands');
    const secondary = this.document.createElement('div');
    secondary.className = 'design-command-secondary';
    overflow.append(secondary, sync);
    for (const row of [...this.panel.querySelectorAll(':scope > .design-toolbar')]) {
      for (const element of [...row.children]) {
        if (element.matches('.panel-spacer,.design-divider')) continue;
        if (element.tagName === 'BUTTON') decorateDesignerButton(element);
        const candidate = preferred.has(element.dataset.designAction);
        this.items.push({element, candidate});
        (candidate ? primary : secondary).append(element);
      }
      row.remove();
    }
    const state = this.document.createElement('span');
    state.className = 'design-command-state';
    state.setAttribute('aria-label', 'Designer synchronization status');
    const toggle = this.document.createElement('div');
    toggle.innerHTML = designerButton('boxes', 'More', 'more');
    const button = toggle.firstElementChild;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.onclick = () => this.opened ? this.close() : this.open();
    bar.append(primary, state, button, overflow);
    this.panel.prepend(bar);
    Object.assign(this, {element: bar, primary, secondary, overflow, button, state});
    this.keyHandler = event => this.keydown(event);
    this.outsideHandler = event => {
      if (this.opened && !bar.contains(event.target)) this.close(false);
    };
    bar.addEventListener('keydown', this.keyHandler);
    this.document.addEventListener('pointerdown', this.outsideHandler, true);
    const Resize = this.document.defaultView?.ResizeObserver;
    if (Resize) {
      this.observer = new Resize(() => this.layout());
      this.observer.observe(bar);
    }
    this.layout();
  }

  layout() {
    if (this.disposed || this.opened || !this.element.clientWidth) return;
    const focused = this.document.activeElement;
    for (const item of this.items) {
      if (item.candidate) this.primary.append(item.element);
    }
    const candidates = this.items.filter(item => item.candidate);
    const available = this.element.clientWidth - this.button.offsetWidth - this.state.offsetWidth - 24;
    for (let index = candidates.length - 1; index >= 0 && this.primary.scrollWidth > available; index--) {
      this.secondary.prepend(candidates[index].element);
    }
    if (focused && this.primary.contains(focused)) focused.focus({preventScroll: true});
  }

  add(element, {primary = false} = {}) {
    this.items.push({element, candidate: primary});
    (primary ? this.primary : this.secondary).append(element);
    this.layout();
  }

  open() {
    if (this.disposed) return;
    this.opened = true;
    this.overflow.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    const bounds = this.element.getBoundingClientRect();
    const viewport = this.document.documentElement.clientWidth;
    const width = Math.min(440, Math.max(240, viewport - 24));
    this.overflow.style.width = width + 'px';
    this.overflow.style.left = Math.max(12, Math.min(viewport - width - 12, bounds.right - width)) + 'px';
    this.overflow.style.top = bounds.bottom + 3 + 'px';
    this.overflow.querySelector(focusable)?.focus();
  }

  close(restoreFocus = true) {
    this.opened = false;
    this.overflow.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.button.focus();
    this.layout();
  }

  keydown(event) {
    if (event.key === 'Escape' && this.opened) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (this.opened && event.key === 'Tab') {
      const controls = [...this.overflow.querySelectorAll(focusable)].filter(control => control.getClientRects().length);
      const current = controls.indexOf(this.document.activeElement);
      const next = event.shiftKey ? current - 1 : current + 1;
      if (next < 0 || next >= controls.length) {
        event.preventDefault();
        controls[(next + controls.length) % controls.length]?.focus();
      }
      return;
    }
    const navigation = ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key);
    if (!this.opened && navigation && event.target.tagName === 'BUTTON') {
      const controls = [...this.element.querySelectorAll(':scope > button,.design-command-primary button')]
        .filter(control => !control.disabled && control.getClientRects().length);
      const index = controls.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length;
      event.preventDefault();
      controls[next]?.focus();
    }
  }

  dispose() {
    this.disposed = true;
    this.observer?.disconnect();
    this.element.removeEventListener('keydown', this.keyHandler);
    this.document.removeEventListener('pointerdown', this.outsideHandler, true);
    this.element.remove();
  }
}
