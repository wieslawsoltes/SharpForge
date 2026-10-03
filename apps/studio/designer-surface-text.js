import {geometryInvariant, normalizeProperty, propertySchema, resolvedProperties} from '@sharpforge/designer';

/** A single-line text transaction uses the rendered control's font and layout metrics. */
export class DesignerInlineText {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.current = null;
  }

  begin(id = this.view.document.selection[0]) {
    this.cancel();
    const view = this.view;
    const node = view.document.node(id);
    geometryInvariant(node && !(view.outline?.isLocked(id) ?? false), 'SFD_TEXT_LOCKED', 'The control is locked.');
    const schema = propertySchema(node.type);
    const property = schema.Text ? 'Text' : schema.Content && !node.children.length ? 'Content' : null;
    geometryInvariant(property, 'SFD_TEXT_UNSUPPORTED', 'This control has no editable inline text or scalar content.');
    const value = resolvedProperties(view.document.value, node).properties[property] ?? '';
    geometryInvariant(['string', 'number', 'boolean'].includes(typeof value),
      'SFD_TEXT_OBJECT', 'Object content must be edited through its visual child.');
    const entry = this.controller.geometry.get(id);
    geometryInvariant(entry, 'SFD_TEXT_LAYOUT', 'The control has no rendered bounds.');
    const input = view.overlay.ownerDocument.createElement('input');
    input.type = 'text';
    input.dataset.inlineText = id;
    input.setAttribute('aria-label', `Edit ${property} for ${node.properties.Name || id}`);
    input.value = String(value);
    const rendered = entry.element.querySelector('button,label,span,input,textarea') ?? entry.element;
    const style = rendered.ownerDocument.defaultView.getComputedStyle(rendered);
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight',
      'letterSpacing', 'textAlign', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'color', 'backgroundColor']) {
      input.style[key] = style[key];
    }
    Object.assign(input.style, {position: 'absolute', left: '0', top: '0', margin: '0', minWidth: '0',
      width: `${entry.width}px`, height: `${entry.height}px`, transformOrigin: '0 0',
      transform: `matrix(${entry.stageMatrix.join(',')})`, boxSizing: 'border-box',
      pointerEvents: 'auto', zIndex: '30', border: '1px solid #60cdff', outline: '1px solid #fff'});
    this.current = {id, property, revision: view.document.revision, document: view.document, input};
    input.onkeydown = event => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        view.safe(() => this.commit());
      }
    };
    input.onblur = () => { if (this.current) view.safe(() => this.commit()); };
    view.overlay.append(input);
    input.focus();
    input.select();
    return input;
  }

  commit() {
    const current = this.current;
    if (!current) return false;
    geometryInvariant(current.document === this.view.document, 'SFD_TEXT_DOCUMENT', 'The active design document changed.');
    const value = current.input.value;
    geometryInvariant(value.length <= 100000, 'SFD_TEXT_LIMIT', 'Inline text exceeds the property text limit.');
    this.current = null;
    current.input.remove();
    return current.document.change(`Edit ${current.property} inline`, candidate => {
      const node = candidate.nodes.find(item => item.id === current.id);
      node.properties[current.property] = normalizeProperty(node.type, current.property, value);
    }, {expectedRevision: current.revision});
  }

  cancel() {
    const current = this.current;
    this.current = null;
    current?.input.remove();
  }

  dispose() {
    this.cancel();
  }
}
