import {DesignerOutlineState, moveOutlineNodes} from './designer-outline-state.js';
import {decorateDesignerButton, designerCommands} from './designer-command-buttons.js';

const symbols = {
  visible: '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>',
  hidden: '<path d="m2 2 12 12M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/>',
  locked: '<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V4a3 3 0 0 1 6 0v3"/>',
  unlocked: '<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V4a3 3 0 0 1 6 0"/>'
};

/** Augments the virtualized outline with local visibility/lock, inline rename and explicit drop positions. */
export class DesignerOutline {
  constructor(view) {
    this.view = view;
    this.state = new DesignerOutlineState(view.document);
    this.root = null;
    this.disposed = false;
    this.dropTarget = null;
  }

  bind() {
    if (this.state.document !== this.view.document) this.state.bind(this.view.document);
    return this.state;
  }

  isVisible(id) { return this.bind().isVisible(id); }
  isLocked(id) { return this.bind().isLocked(id); }
  filterSelection(ids) { return this.bind().filterSelection(ids); }
  assertEditable(ids = this.view.document.selection) { this.bind().assertEditable(ids); }

  install() {
    if (this.root || this.disposed) return;
    this.root = this.view.panel('designer-tree').querySelector('.design-tree');
    if (!this.root) return;
    for (const [selector, command] of [['[data-tree-up]', 'up'], ['[data-tree-down]', 'down'], ['[data-tree-delete]', 'delete']]) {
      const button = this.view.panel('designer-tree').querySelector(selector);
      if (button) decorateDesignerButton(button, designerCommands[command]);
    }
    this.handlers = {
      scroll: () => this.render(),
      keydown: event => this.keydown(event),
      dblclick: event => {
        if (event.target.closest('.sf-tree-label')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.view.safe(() => this.rename(event.target.closest('[data-tree-id]')?.dataset.treeId));
        }
      },
      dragstart: event => this.dragStart(event),
      dragover: event => this.dragOver(event),
      dragleave: event => { if (!this.root.contains(event.relatedTarget)) this.clearDrop(); },
      drop: event => this.drop(event),
      dragend: () => this.clearDrop()
    };
    for (const [name, handler] of Object.entries(this.handlers)) this.root.addEventListener(name, handler, name !== 'scroll');
  }

  render() {
    this.install();
    this.state.bind(this.view.document);
    if (!this.root || this.disposed) return;
    for (const row of this.root.querySelectorAll('[data-tree-id]')) {
      const id = row.dataset.treeId;
      row.classList.toggle('design-outline-hidden', !this.isVisible(id));
      row.classList.toggle('design-outline-locked', this.isLocked(id));
      row.draggable = id !== this.view.document.value.root && !this.isLocked(id);
      let controls = row.querySelector('.design-outline-actions');
      if (!controls) {
        controls = row.ownerDocument.createElement('span');
        controls.className = 'design-outline-actions';
        controls.append(this.createToggle(id, 'hidden'), this.createToggle(id, 'locked'));
        row.append(controls);
      }
      this.renderToggle(controls.children[0], id, 'hidden');
      this.renderToggle(controls.children[1], id, 'locked');
    }
    for (const [id, element] of this.view.host?.elements ?? []) {
      if (!this.view.document.node(id)) continue;
      const hidden = !this.isVisible(id);
      if (hidden) element.setAttribute('data-design-hidden', 'true');
      else element.removeAttribute('data-design-hidden');
    }
  }

  createToggle(id, kind) {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.dataset.outlineAction = kind;
    button.onclick = event => {
      event.stopPropagation();
      this.view.safe(() => this.toggle(id, kind));
    };
    button.onpointerdown = event => event.stopPropagation();
    return button;
  }

  renderToggle(button, id, kind) {
    const active = this.state[kind].has(id);
    const label = kind === 'hidden' ? active ? 'Show' : 'Hide' : active ? 'Unlock' : 'Lock';
    const node = this.view.document.node(id);
    button.setAttribute('aria-label', `${label} ${node?.properties.Name ?? id} at design time`);
    button.setAttribute('aria-pressed', String(active));
    button.title = button.getAttribute('aria-label');
    button.disabled = kind === 'hidden' && id === this.view.document.value.root;
    const glyph = kind === 'hidden' ? active ? 'hidden' : 'visible' : active ? 'locked' : 'unlocked';
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${symbols[glyph]}</svg>`;
  }

  toggle(id, kind) {
    this.state.toggle(id, kind);
    this.render();
    this.view.drawAdorners();
    this.view.accessibility?.announce(`${id} ${this.state[kind].has(id) ? kind : kind === 'hidden' ? 'visible' : 'unlocked'}`);
  }

  rename(id = this.view.document.selection[0]) {
    if (!id) return;
    this.assertEditable([id]);
    const node = this.view.document.node(id);
    if (!node) throw new TypeError('Control no longer exists');
    const row = [...this.root.querySelectorAll('[data-tree-id]')].find(element => element.dataset.treeId === id);
    const label = row?.querySelector('.sf-tree-label');
    if (!label) return;
    const input = row.ownerDocument.createElement('input');
    input.className = 'design-outline-rename';
    input.value = node.properties.Name ?? '';
    input.setAttribute('aria-label', 'Rename ' + id);
    input.maxLength = 128;
    let completed = false;
    const finish = commit => {
      if (completed) return;
      completed = true;
      if (commit) this.view.safe(() => this.view.document.setProperty('Name', input.value, [id]));
      input.replaceWith(label);
      this.view.treeView.render();
      this.render();
      this.root.focus();
    };
    input.onkeydown = event => {
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        finish(event.key === 'Enter');
      }
    };
    input.onblur = () => finish(false);
    input.onclick = event => event.stopPropagation();
    input.onpointerdown = event => event.stopPropagation();
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  keydown(event) {
    if (event.target.matches('input,button')) return;
    if (event.key === 'F2') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.view.safe(() => this.rename());
    }
  }

  dragStart(event) {
    const row = event.target.closest('[data-tree-id]');
    if (!row) return;
    if (this.isLocked(row.dataset.treeId)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  dragOver(event) {
    if (!event.dataTransfer.types.includes('application/x-sharpforge-tree')) return;
    event.stopImmediatePropagation();
    const row = event.target.closest('[data-tree-id]');
    if (!row || this.isLocked(row.dataset.treeId)) {
      this.clearDrop();
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    const bounds = row.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    const position = ratio < .25 ? 'before' : ratio > .75 ? 'after' : 'inside';
    this.clearDrop();
    this.dropTarget = {id: row.dataset.treeId, position, row};
    row.dataset.designDrop = position;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  drop(event) {
    if (!event.dataTransfer.types.includes('application/x-sharpforge-tree')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = this.dropTarget;
    this.clearDrop();
    if (!target) return;
    this.bind();
    this.view.safe(() => {
      const text = event.dataTransfer.getData('application/x-sharpforge-tree');
      if (text.length > 100_000) throw new RangeError('Outline drag payload exceeds limit');
      const data = JSON.parse(text);
      if (data.tree !== this.view.treeView.id) throw new TypeError('Controls must come from this document outline');
      return moveOutlineNodes(this.view.document, this.state, data.ids, target.id, target.position);
    });
  }

  clearDrop() {
    if (this.dropTarget) delete this.dropTarget.row.dataset.designDrop;
    this.dropTarget = null;
  }

  dispose() {
    this.disposed = true;
    this.clearDrop();
    for (const [name, handler] of Object.entries(this.handlers ?? {})) this.root?.removeEventListener(name, handler, name !== 'scroll');
    this.root = null;
  }
}
