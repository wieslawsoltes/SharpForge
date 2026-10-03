import {designerResourceEntries, designerBrushCss, designerInstancePreviews, designerPreviewDecorations} from '@sharpforge/designer';
import {WinUIHost} from '@sharpforge/winui';

/** Resource classes replace the visual scaffold with a bounded gallery of inert, independently rendered entries. */
export class DesignerResourceGallery {
  constructor(view) {
    this.view = view;
    this.page = 0;
    this.hosts = [];
    this.revision = -1;
    this.document = null;
  }

  render() {
    const view = this.view;
    const active = view.document.value.documentKind === 'resources' && !view.templateScope;
    view.scroller.classList.toggle('design-resource-scaffold-hidden', active);
    if (this.root) this.root.hidden = !active;
    if (!active) { this.clear(); return; }
    if (!this.root) {
      this.root = view.stage.ownerDocument.createElement('section');
      this.root.className = 'design-resource-gallery';
      this.root.setAttribute('aria-label', 'Resource dictionary entries');
      view.panel('designer').insertBefore(this.root, view.statusElement);
    }
    if (this.document === view.document && this.revision === view.document.revision) return;
    this.document = view.document;
    this.revision = view.document.revision;
    this.draw();
  }

  clear() { for (const host of this.hosts.splice(0)) host.dispose(); }

  draw() {
    this.clear();
    const view = this.view;
    const document = this.root.ownerDocument;
    const entries = designerResourceEntries(view.document.value);
    const pages = Math.max(1, Math.ceil(entries.length / 8));
    this.page = Math.min(this.page, pages - 1);
    this.root.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = view.document.value.name;
    const help = document.createElement('p');
    help.textContent = 'Select an entry to edit its values, rename references, or open its template. Previews do not run application code.';
    const list = document.createElement('div');
    list.className = 'design-resource-gallery-items';
    for (const entry of entries.slice(this.page * 8, (this.page + 1) * 8)) list.append(this.card(entry));
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Use Resources to add a brush, style, or template.';
      list.append(empty);
    }
    this.root.append(heading, help, list);
    const controls = document.createElement('nav');
    controls.setAttribute('aria-label', 'Resource preview pages');
    for (const [label, offset] of [['Previous', -1], ['Next', 1]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = this.page + offset < 0 || this.page + offset >= pages;
      button.onclick = () => { this.page += offset; this.view.safe(() => this.draw()); };
      controls.append(button);
    }
    const count = document.createElement('span');
    count.textContent = `Page ${this.page + 1} of ${pages} · ${entries.length} entries`;
    controls.append(count);
    this.root.append(controls);
  }

  card(entry) {
    const view = this.view;
    const document = this.root.ownerDocument;
    const card = document.createElement('article');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.key + ' · ' + entry.kind;
    button.dataset.resourceKey = entry.key;
    button.onclick = () => {
      view.resources.selectedKey = entry.key;
      view.resources.render();
      view.docking.activate('designer-styles');
    };
    const surface = document.createElement('div');
    surface.className = 'design-resource-gallery-preview';
    card.append(button, surface);
    if (['brush', 'theme'].includes(entry.kind)) {
      const theme = view.surface.preview.value.theme;
      const value = entry.kind === 'theme' ? entry.value.variants[theme] ?? entry.value.variants.default : entry.value.value;
      surface.style.background = designerBrushCss(value);
    } else {
      const preview = designerInstancePreviews(view.document.value, {resourceKey: entry.key, kind: entry.kind,
        themes: [view.surface.preview.value.theme], states: ['Normal'], resolveAsset: uri => view.assetPreviews.resolve(uri)})[0];
      const host = new WinUIHost(surface, {backend: 'dom', onEvent: () => {}, onError: error => view.error(error)});
      this.hosts.push(host);
      host.load(preview.scene);
      host.flush();
      for (const decoration of designerPreviewDecorations(preview.scene)) {
        const element = host.elements.get(decoration.id);
        if (element) element.style[decoration.property] = decoration.value;
      }
    }
    return card;
  }

  dispose() { this.clear(); this.root?.remove(); }
}
