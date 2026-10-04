const defaults = Object.freeze({ Caption: '', IsCaptionVisible: true, IsContentVisible: true, IsGlyphVisible: true });
export function dragVisualState(value = {}) {
  const result = { ...defaults };
  if (value.Caption != null) {
    if (typeof value.Caption !== 'string' || value.Caption.length > 4096) throw new RangeError('SFUI1666: Invalid drag caption');
    result.Caption = value.Caption;
  }
  for (const name of ['IsCaptionVisible', 'IsContentVisible', 'IsGlyphVisible']) {
    if (value[name] != null && typeof value[name] !== 'boolean') throw new TypeError('SFUI1666: Invalid drag visual visibility');
    result[name] = value[name] ?? true;
  }
  if (value.Bitmap != null) {
    if (typeof value.Bitmap !== 'string' || value.Bitmap.length > 256) throw new TypeError('SFUI1666: Invalid drag bitmap reference');
    result.Bitmap = value.Bitmap;
    const point = value.Anchor ?? { X: 0, Y: 0 };
    if (![point.X, point.Y].every(Number.isFinite)) throw new TypeError('SFUI1666: Invalid drag bitmap anchor');
    result.Anchor = { X: point.X, Y: point.Y };
  }
  return result;
}

/** Caption feedback uses real DOM, is scoped to the host, and never copies editable/private source content. */
export class DragVisual {
  constructor({ root, bitmapElement } = {}) { this.root = root; this.bitmapElement = bitmapElement; this.element = null; }
  update(value, position, operation) {
    if (!this.root?.ownerDocument) return;
    const state = dragVisualState(value);
    if (!this.element) {
      const element = this.root.ownerDocument.createElement('div');
      element.setAttribute('data-sf-drag-visual', '');
      element.setAttribute('aria-hidden', 'true');
      Object.assign(element.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2147483647',
        padding: '4px 8px', background: 'Canvas', color: 'CanvasText', border: '1px solid GrayText', borderRadius: '4px' });
      this.root.appendChild(element); this.element = element;
    }
    const glyph = state.IsGlyphVisible ? ({ 1: '+ ', 2: '↗ ', 4: '↪ ' }[operation] ?? '') : '';
    this.element.textContent = glyph + (state.IsCaptionVisible ? state.Caption : '');
    this.element.hidden = !this.element.textContent;
    this.element.style.transform = `translate(${position.X + 12}px,${position.Y + 18}px)`;
    if (state.Bitmap && state.IsContentVisible) {
      const bitmap = this.bitmapElement?.(state.Bitmap);
      if (!bitmap) throw new Error('SFUI1668: Drag bitmap requires a registered image resource');
      const image = bitmap.cloneNode(true);
      this.element.prepend(image);
      this.element.hidden = false;
    }
  }
  start(transfer, value) {
    const state = dragVisualState(value);
    if (state.Bitmap) {
      const bitmap = this.bitmapElement?.(state.Bitmap);
      if (!bitmap || !transfer?.setDragImage) throw new Error('SFUI1668: Native bitmap drag image is unavailable');
      transfer.setDragImage(bitmap, state.Anchor.X, state.Anchor.Y);
    }
  }
  clear() { this.element?.remove(); this.element = null; }
  dispose() { this.clear(); }
}
