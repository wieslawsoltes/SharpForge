/** Routes document-level menus without taking events owned by nested interactive surfaces. */
export class StudioContextMenuRouter {
  constructor({editors, menu, dockItems, breakpointItems, editorItems, panelItems}) {
    this.editors = editors;
    this.menu = menu;
    this.dockItems = dockItems;
    this.breakpointItems = breakpointItems;
    this.editorItems = editorItems;
    this.panelItems = panelItems;
    this.documents = new WeakMap();
  }

  show(document, event, keyboard = false) {
    const target = event.target;
    if (event.defaultPrevented || !target?.closest) return false;
    // Design and Code share a data-source-uri ancestor; the surface owns its own menu.
    if (target.closest('.sf-menu,#modal-backdrop,.sf-tree,.design-scroll')) return false;
    const tab = target.closest('[data-dock-tab]');
    const source = target.closest('[data-source-uri]');
    const tool = target.closest('[data-tool]');
    let items;
    let anchor = target;
    if (tab) items = this.dockItems(tab.dataset.dockTab);
    else if (source) {
      const instance = this.editors.get(source.dataset.sourceUri);
      if (!instance) return false;
      const gutter = target.closest('[data-line]');
      items = gutter ? this.breakpointItems(instance.uri, Number(gutter.dataset.line)) : this.editorItems(instance);
      anchor = instance.keymapAdapter?.cm.getInputField() ?? instance.input;
    } else if (tool) items = this.panelItems(tool.dataset.tool, target);
    if (!items) return false;
    let x = event.clientX;
    let y = event.clientY;
    if (keyboard) {
      const rectangle = target.getBoundingClientRect();
      x = rectangle.left + Math.min(40, rectangle.width / 2);
      y = rectangle.top + Math.min(30, rectangle.height);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.menu.show({items, x, y, anchor, document});
    return true;
  }

  /** Installs once per main/popout document; the returned cleanup permits later reinstallation. */
  install(document) {
    if (this.documents.has(document)) return this.documents.get(document);
    const contextmenu = event => this.show(document, event);
    const keydown = event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') this.show(document, event, true);
    };
    document.addEventListener('contextmenu', contextmenu, true);
    document.addEventListener('keydown', keydown, true);
    const dispose = () => {
      if (this.documents.get(document) !== dispose) return;
      document.removeEventListener('contextmenu', contextmenu, true);
      document.removeEventListener('keydown', keydown, true);
      this.documents.delete(document);
    };
    this.documents.set(document, dispose);
    return dispose;
  }
}
