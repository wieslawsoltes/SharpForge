import {DesignerAuthoringError} from '@sharpforge/designer';

const dictionaryActions = new Set(['new', 'open', 'save', 'download', 'undo', 'redo', 'source', 'options', 'properties']);
const applicationActions = new Set(['attach', 'apply', 'run-app', 'generate']);
const visualPanels = ['designer-toolbox', 'designer-properties', 'designer-layout', 'designer-tree'];
const canvasControls = '#designer-mode,#designer-snap,#designer-zoom,#designer-width,#designer-height,#designer-backend';

/** The dictionary scaffold is serialization infrastructure; template scope is an editable visual document. */
export function isDesignerResourceDocument(view) {
  return !view.templateScope && view.document.value.documentKind === 'resources';
}

export function designerResourceActionAllowed(view, action) {
  const owner = view.session?.document ?? view.document;
  if (owner.value.documentKind === 'resources' && applicationActions.has(action)) return false;
  return !isDesignerResourceDocument(view) || dictionaryActions.has(action);
}

export function assertDesignerResourceAction(view, action) {
  if (!designerResourceActionAllowed(view, action)) {
    throw new DesignerAuthoringError('SFD1854', 'Use Resources to edit this dictionary, or open a template to edit its visual tree.', {action});
  }
}

/** Hides existing visual controls without destroying their listeners or cached renderer elements. */
export class DesignerResourceContext {
  constructor(view) {
    this.view = view;
    this.hidden = new Map();
  }

  update() {
    const view = this.view;
    const active = isDesignerResourceDocument(view);
    for (const [element, previous] of this.hidden) {
      element.hidden = previous.hidden;
      element.inert = previous.inert;
    }
    this.hidden.clear();
    const conceal = element => {
      if (!element || this.hidden.has(element)) return;
      this.hidden.set(element, {hidden: element.hidden, inert: element.inert});
      element.hidden = true;
      element.inert = true;
    };
    for (const button of view.controlsRoot?.querySelectorAll('[data-design-action]') ?? []) {
      if (!designerResourceActionAllowed(view, button.dataset.designAction)) conceal(button);
    }
    if (active) {
      for (const control of view.controlsRoot?.querySelectorAll(canvasControls) ?? []) conceal(control.closest('label') ?? control);
      for (const control of view.controlsRoot?.querySelectorAll('[data-design-view="preview"]') ?? []) conceal(control);
      conceal(view.surface.preview.toolbar);
    }
    view.scroller.classList.toggle('design-resource-scaffold-hidden', active);
    view.scroller.inert = active;
    for (const id of visualPanels) this.renderPanel(id);
    view.chrome.commandBar?.layout();
  }

  renderPanel(id) {
    const panel = this.view.panel(id);
    const active = isDesignerResourceDocument(this.view);
    if (!panel) return active;
    panel.classList.toggle('design-resource-visual-disabled', active);
    let notice = panel.querySelector(':scope > .design-resource-unavailable');
    if (!active) {
      notice?.remove();
      return false;
    }
    if (!notice) {
      notice = panel.ownerDocument.createElement('div');
      notice.className = 'design-resource-unavailable';
      const text = panel.ownerDocument.createElement('p');
      text.textContent = 'Edit dictionary entries in Resources. Open a template to use the visual editing tools.';
      const button = panel.ownerDocument.createElement('button');
      button.type = 'button';
      button.textContent = 'Open Resources';
      button.onclick = () => this.view.docking.activate('designer-styles');
      notice.append(text, button);
      panel.append(notice);
    }
    return true;
  }

  breadcrumbContext() {
    if (!isDesignerResourceDocument(this.view)) return undefined;
    return {label: 'Resources', count: 0, crumbs: [{id: 'resources', label: this.view.document.value.name,
      select: () => this.view.docking.activate('designer-styles')}]};
  }

  dispose() {
    for (const [element, previous] of this.hidden) {
      element.hidden = previous.hidden;
      element.inert = previous.inert;
    }
    this.hidden.clear();
    this.view.scroller?.classList.remove('design-resource-scaffold-hidden');
    if (this.view.scroller) this.view.scroller.inert = false;
    for (const id of visualPanels) {
      const panel = this.view.panel(id);
      panel?.classList.remove('design-resource-visual-disabled');
      panel?.querySelector(':scope > .design-resource-unavailable')?.remove();
    }
  }
}
