/** MRU window navigator commits only when Ctrl/Alt is released, so cycling never perturbs MRU order. */
export class WindowNavigator {
  constructor({ host, tabs } = {}) {
    this.host = host;
    this.tabs = tabs;
    this.entries = [];
    this.index = 0;
    this.toolMru = [];
    this.overlay = null;
    this.document = null;
    this.off = host.layout.subscribe(event => {
      if (event.type !== 'activate') return;
      const id = host.layout.state.activePanel;
      if (id && host.layout.require(id).kind === 'tool') this.toolMru = [id, ...this.toolMru.filter(item => item !== id)];
    });
  }

  open({ toolsOnly = false, reverse = false, document = this.host.element.ownerDocument } = {}) {
    if (this.overlay) { this.step(reverse ? -1 : 1); return; }
    const visible = [...this.host.layout.panels.keys()].filter(id => this.host.layout.locate(id).kind !== 'closed');
    const documents = [...this.tabs.mru, ...this.tabs.list()].filter((id, index, all) => all.indexOf(id) === index && visible.includes(id));
    const tools = [...this.toolMru, ...visible.filter(id => this.host.layout.require(id).kind === 'tool')]
      .filter((id, index, all) => all.indexOf(id) === index && visible.includes(id));
    this.entries = toolsOnly ? tools : [...documents, ...tools];
    if (!this.entries.length) return;
    this.modifier = toolsOnly ? 'Alt' : 'Control';
    this.document = document;
    this.previousFocus = document.activeElement;
    this.index = this.entries.length === 1 ? 0 : reverse ? this.entries.length - 1 : 1;
    this.overlay = document.createElement('div');
    this.overlay.className = 'sf-window-navigator';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'IDE Navigator');
    const title = document.createElement('h2');
    title.textContent = toolsOnly ? 'Active Tool Windows' : 'IDE Navigator';
    this.list = document.createElement('div');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Active files and tools');
    this.list.tabIndex = 0;
    this.overlay.append(title, this.list);
    document.body.append(this.overlay);
    this.keyDown = event => this.handle(event);
    this.keyUp = event => { if (event.key === this.modifier) { event.preventDefault(); this.commit(); } };
    document.addEventListener('keydown', this.keyDown, true);
    document.addEventListener('keyup', this.keyUp, true);
    this.render();
    this.list.focus();
  }

  render() {
    this.list.replaceChildren();
    this.entries.forEach((id, index) => {
      const option = this.document.createElement('div');
      option.id = `sf-navigator-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === this.index));
      option.className = index === this.index ? 'selected' : '';
      option.textContent = `${this.tabs.metadata(id) ? 'File' : 'Tool'} · ${this.host.layout.require(id).description ?? this.host.layout.require(id).title}`;
      option.onclick = () => { this.index = index; this.commit(); };
      this.list.append(option);
    });
    this.list.setAttribute('aria-activedescendant', `sf-navigator-option-${this.index}`);
    this.list.children[this.index]?.scrollIntoView?.({ block: 'nearest' });
  }

  step(delta) { this.index = (this.index + delta + this.entries.length) % this.entries.length; this.render(); }
  handle(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); this.commit(); return; }
    if (!['Tab', 'F7', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Home') this.index = 0;
    else if (event.key === 'End') this.index = this.entries.length - 1;
    else this.index = (this.index + (event.shiftKey || ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + this.entries.length) % this.entries.length;
    this.render();
  }

  commit() {
    const id = this.entries[this.index];
    this.close(false);
    if (id && this.host.layout.panels.has(id)) {
      if (this.tabs.metadata(id)) this.tabs.activate(id);
      this.host.focusPanel(id);
    }
  }

  close(restoreFocus = true) {
    this.overlay?.remove();
    this.document?.removeEventListener('keydown', this.keyDown, true);
    this.document?.removeEventListener('keyup', this.keyUp, true);
    this.overlay = null;
    if (restoreFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }

  dispose() { this.close(); this.off(); }
}
