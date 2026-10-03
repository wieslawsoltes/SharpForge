import {designerInstancePreviews, designerPreviewDecorations} from '../../packages/designer/src/index.js';
import {WinUIHost} from '../../packages/winui/src/index.js';
import {propertyElement} from './designer-property-dom.js';

/** The strip owns and disposes every host; it never dispatches application callbacks. */
export class DesignerInstancePreviewController {
  constructor({onError = () => {}} = {}) {
    this.onError = onError;
    this.hosts = [];
  }

  render(container, design, options = {}) {
    this.dispose();
    container.replaceChildren();
    container.classList.add('design-instance-previews');
    const document = container.ownerDocument;
    const previews = designerInstancePreviews(design, options);
    for (const preview of previews) {
      const figure = propertyElement(document, 'figure', '', 'design-instance-preview');
      figure.dataset.theme = preview.theme;
      figure.dataset.state = preview.state;
      const caption = propertyElement(document, 'figcaption', `${preview.theme} · ${preview.state}`);
      const surface = propertyElement(document, 'div', '', 'design-instance-surface');
      figure.append(caption, surface);
      container.append(figure);
      const host = new WinUIHost(surface, {backend: 'dom', onError: this.onError, onEvent: () => {}});
      host.load(preview.scene);
      host.flush();
      for (const decoration of designerPreviewDecorations(preview.scene)) {
        const element = host.elements.get(decoration.id);
        if (element) element.style[decoration.property] = decoration.value;
      }
      surface.dataset.theme = preview.theme;
      this.hosts.push(host);
    }
    container.append(propertyElement(document, 'p', 'Recorded state setters are applied to each independent preview. Unspecified states use the base style.'));
  }

  dispose() {
    this.hosts.forEach(host => host.dispose());
    this.hosts = [];
  }
}
