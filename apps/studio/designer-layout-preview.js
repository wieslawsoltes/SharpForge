import {DesignPreviewEnvironment, designScene} from '@sharpforge/designer';

/** Device presets and accessibility switches change only the rendered session. */
export class DesignerLayoutPreview {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.environment = new DesignPreviewEnvironment();
  }

  get value() {
    return this.environment.value;
  }

  install() {
    const panel = this.view.panel('designer');
    const toolbar = panel.ownerDocument.createElement('div');
    toolbar.className = 'design-preview-environment-controls';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Device and accessibility preview');
    Object.assign(toolbar.style, {display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center'});
    toolbar.dataset.previewEnvironment = '';
    const fields = [
      ['device', 'Preview device', [['document', 'Document'], ['1440x900', 'Desktop'], ['1024x768', 'Tablet'], ['390x844', 'Phone']]],
      ['scale', 'Preview scale', [['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%']]],
      ['theme', 'Preview theme', [['dark', 'Dark'], ['light', 'Light']]],
      ['contrast', 'Preview contrast', [['normal', 'Normal contrast'], ['high', 'High contrast']]],
      ['direction', 'Preview flow direction', [['ltr', 'Left to right'], ['rtl', 'Right to left']]]
    ];
    for (const [key, label, options] of fields) {
      const select = panel.ownerDocument.createElement('select');
      select.setAttribute('aria-label', label);
      select.dataset.previewOption = key;
      for (const [value, text] of options) {
        const option = panel.ownerDocument.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.onchange = () => this.view.safe(() => {
        if (key === 'device') {
          const [width, height] = select.value === 'document' ? [null, null] : select.value.split('x').map(Number);
          this.set({width, height});
        } else this.set({[key]: key === 'scale' ? Number(select.value) : select.value});
      });
      toolbar.append(select);
    }
    const fit = panel.ownerDocument.createElement('button');
    fit.textContent = 'Fit selection';
    fit.onclick = () => this.controller.fitSelection();
    toolbar.append(fit);
    if (this.view.chrome?.commandBar) this.view.chrome.commandBar.add(toolbar);
    else panel.insertBefore(toolbar, this.view.scroller);
    this.toolbar = toolbar;
  }

  set(patch) {
    this.environment.update(patch);
    this.render();
    this.controller.layout?.render();
    return this.value;
  }

  scene(document = this.view.document.value, {appearance = true} = {}) {
    const scene = designScene(this.environment.document(document));
    return appearance ? this.environment.applyToScene(scene) : scene;
  }

  render() {
    const view = this.view;
    const value = this.value;
    if (view.updatePreview) view.updatePreview();
    else {
      view.host.load(this.scene());
      view.host.flush();
    }
    this.applyDimensions();
    this.controller.geometry.invalidate();
    this.controller.drawAdorners();
  }

  applyDimensions() {
    const view = this.view;
    const value = this.value;
    const width = value.width ?? view.document.value.width;
    const height = value.height ?? view.document.value.height;
    view.stage.style.width = `${width}px`;
    view.stage.style.height = `${height}px`;
    view.stage.parentElement.style.width = `${width * view.zoom}px`;
    view.stage.parentElement.style.height = `${height * view.zoom}px`;
    view.previewRoot.style.width = `${width / value.scale}px`;
    view.previewRoot.style.height = `${height / value.scale}px`;
    view.previewRoot.style.transformOrigin = '0 0';
    view.previewRoot.style.transform = `scale(${value.scale})`;
    view.previewRoot.dataset.theme = value.theme;
    view.previewRoot.dataset.contrast = value.contrast;
    view.previewRoot.dir = value.direction;
    view.previewRoot.style.direction = value.direction;
    view.previewRoot.style.colorScheme = value.theme;
    const colors = value.contrast === 'high' ? {'--sf-app-bg': '#000000', '--sf-app-fg': '#ffffff',
      '--sf-app-input': '#000000', '--sf-app-line': '#ffffff', '--sf-app-accent': '#ffff00'} : {};
    for (const name of ['--sf-app-bg', '--sf-app-fg', '--sf-app-input', '--sf-app-line', '--sf-app-accent']) {
      if (colors[name]) view.previewRoot.style.setProperty(name, colors[name]);
      else view.previewRoot.style.removeProperty(name);
    }
  }

  dispose() {
    this.toolbar?.remove();
  }
}
