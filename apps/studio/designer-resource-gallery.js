import {
  designerResourceEntries, designerBrushCss, designerInstancePreviews, designerPreviewDecorations, formatDesignerProperty
} from '@sharpforge/designer';
import {WinUIHost} from '@sharpforge/winui';
import {isDesignerResourceDocument} from './designer-resource-context.js';
import {designerResourceLabel, designerResourceValue, isDesignerBrushResource} from './designer-resource-values.js';
import {propertyButton, propertyElement, propertySelect} from './designer-property-dom.js';

const statePresets = ['Normal', 'PointerOver', 'Pressed', 'Disabled', 'Focused'];

/** The gallery owns at most eight inert hosts and mounts them only after their cards join the document. */
export class DesignerResourceGallery {
  constructor(view, {createHost = (element, options) => new WinUIHost(element, options)} = {}) {
    this.view = view;
    this.createHost = createHost;
    this.page = 0;
    this.state = 'Normal';
    this.hosts = [];
    this.pending = [];
    this.signature = null;
    this.disposed = false;
  }

  render({force = false} = {}) {
    if (this.disposed) return false;
    const view = this.view;
    const active = isDesignerResourceDocument(view);
    if (this.root) this.root.hidden = !active;
    if (!active) { this.clear(); return false; }
    if (!this.root) this.createRoot();
    const environment = view.surface.preview.value;
    const theme = environment.contrast === 'high' ? 'highContrast' : environment.theme;
    const signature = [view.document, view.document.revision, theme, this.state,
      view.assetPreviewController?.version ?? view.assetPreviews?.urls?.size ?? 0];
    if (force || !this.signature || signature.some((value, index) => value !== this.signature[index])) {
      this.draw(theme);
      this.signature = signature;
    }
    this.mountPending();
    return true;
  }

  createRoot() {
    const view = this.view;
    this.root = propertyElement(view.stage.ownerDocument, 'section', '', 'design-resource-gallery');
    this.root.setAttribute('aria-label', 'Resource dictionary entries');
    view.panel('designer').insertBefore(this.root, view.statusElement);
    const Resize = this.root.ownerDocument.defaultView?.ResizeObserver;
    if (Resize) {
      this.observer = new Resize(() => this.mountPending());
      this.observer.observe(this.root);
    }
  }

  clear() {
    for (const host of this.hosts.splice(0)) host.dispose();
    this.pending.length = 0;
    this.signature = null;
  }

  draw(theme) {
    this.clear();
    const view = this.view;
    const document = this.root.ownerDocument;
    const entries = designerResourceEntries(view.document.value);
    const pages = Math.max(1, Math.ceil(entries.length / 8));
    this.page = Math.min(this.page, pages - 1);
    const heading = propertyElement(document, 'h2', view.document.value.name);
    const help = propertyElement(document, 'p', 'Select an entry to edit it in Resources. Previews never run application code.');
    const list = propertyElement(document, 'div', '', 'design-resource-gallery-items');
    const controls = this.pageControls(document, pages, entries.length);
    this.root.replaceChildren(heading, help, this.previewControls(document, theme), list, controls);
    for (const entry of entries.slice(this.page * 8, (this.page + 1) * 8)) list.append(this.card(entry, theme));
    if (!entries.length) list.append(propertyElement(document, 'p', 'Use Resources to add a brush, style, or template.'));
  }

  previewControls(document, theme) {
    const controls = propertyElement(document, 'div', '', 'design-resource-gallery-options');
    const themes = propertySelect(document, [
      {value: 'light', label: 'Light'}, {value: 'dark', label: 'Dark'}, {value: 'highContrast', label: 'High contrast'}
    ], theme, 'Dictionary preview theme');
    const states = propertySelect(document, statePresets, this.state, 'Dictionary preview state');
    themes.addEventListener('change', () => this.view.safe(() => {
      this.view.surface.preview.environment.update(themes.value === 'highContrast' ? {contrast: 'high'} :
        {theme: themes.value, contrast: 'normal'});
      this.view.updatePreview();
    }));
    states.addEventListener('change', () => this.view.safe(() => { this.state = states.value; this.render(); }));
    controls.append(themes, states, propertyButton(document, 'Open Resources', () => this.view.docking.activate('designer-styles')));
    return controls;
  }

  pageControls(document, pages, count) {
    const controls = propertyElement(document, 'nav');
    controls.setAttribute('aria-label', 'Resource preview pages');
    for (const [label, offset] of [['Previous', -1], ['Next', 1]]) {
      controls.append(propertyButton(document, label, () => this.view.safe(() => {
        this.page += offset;
        this.render({force: true});
      }), {disabled: this.page + offset < 0 || this.page + offset >= pages}));
    }
    controls.append(propertyElement(document, 'span', `Page ${this.page + 1} of ${pages} · ${count} entries`));
    return controls;
  }

  card(entry, theme) {
    const view = this.view;
    const document = this.root.ownerDocument;
    const card = propertyElement(document, 'article');
    const button = propertyButton(document, entry.key + ' · ' + designerResourceLabel(entry), () => view.safe(() => {
      view.resources.selectedKey = entry.key;
      view.resources.search = '';
      view.resources.render();
      view.docking.activate('designer-styles');
    }));
    button.dataset.resourceKey = entry.key;
    const surface = propertyElement(document, 'div', '', 'design-resource-gallery-preview');
    surface.dataset.theme = theme === 'highContrast' ? 'dark' : theme;
    surface.dataset.contrast = theme === 'highContrast' ? 'high' : 'normal';
    card.append(button, surface);
    if (['style', 'template'].includes(entry.kind)) {
      this.pending.push({entry, theme, surface});
    } else if (isDesignerBrushResource(entry)) {
      surface.style.background = designerBrushCss(designerResourceValue(entry, theme));
      surface.setAttribute('aria-label', entry.key + ' brush preview');
    } else {
      surface.classList.add('design-resource-scalar-preview');
      surface.append(propertyElement(document, 'code', formatDesignerProperty(designerResourceValue(entry, theme))));
    }
    return card;
  }

  mountPending() {
    if (this.disposed || !this.root?.isConnected || this.root.hidden || !isDesignerResourceDocument(this.view)) return;
    for (const {entry, theme, surface} of this.pending.splice(0)) {
      if (!surface.isConnected) continue;
      let host;
      try {
        const preview = designerInstancePreviews(this.view.document.value, {resourceKey: entry.key, kind: entry.kind,
          themes: [theme], states: [this.state], resolveAsset: uri => this.view.assetPreviews?.resolve(uri)})[0];
        host = this.createHost(surface, {backend: 'dom', onEvent: () => {}, onError: error => this.previewError(surface, error)});
        host.load(preview.scene);
        host.flush();
        for (const decoration of designerPreviewDecorations(preview.scene)) {
          const element = host.elements.get(decoration.id);
          if (element) element.style[decoration.property] = decoration.value;
        }
        this.hosts.push(host);
      } catch (error) {
        host?.dispose();
        this.previewError(surface, error);
      }
    }
  }

  previewError(surface, error) {
    surface.replaceChildren(propertyElement(surface.ownerDocument, 'p', error.diagnostic?.message ?? error.message, 'design-editor-error'));
    surface.dataset.previewError = error.code ?? 'SFD1854';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.observer?.disconnect();
    this.root?.remove();
  }
}
