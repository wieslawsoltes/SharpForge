const coordinate = value => Number.isFinite(value) ? value : 0;

function stationaryStyle(style) {
  if (!style) return true;
  if (style.animationName && style.animationName !== 'none') return false;
  if (style.transitionDuration?.split(',').some(duration => Number.parseFloat(duration) > 0)) return false;
  for (const name of ['translate', 'rotate', 'scale', 'offsetPath']) {
    if (style[name] && style[name] !== 'none') return false;
  }
  return true;
}

function computedMatrix(transform) {
  if (!transform || transform === 'none') return [1, 0, 0, 1, 0, 0];
  const match = /^matrix\(([^)]+)\)$/.exec(transform);
  if (!match) return null;
  const values = match[1].split(',').map(Number);
  return values.length === 6 && values.every(Number.isFinite) ? values : null;
}

function affineTransform(element, style) {
  if (!style) return element.style.transform ? null : {text: '', matrix: null};
  const matrix = computedMatrix(style.transform);
  if (!matrix) return null;
  // Retain authored transform precision; computed matrices may serialize rounded coefficients.
  const text = !style.transform || style.transform === 'none' ? '' : element.style.transform || style.transform;
  return {text, matrix};
}

function effectiveTranslation(style, record, left, top) {
  if (!style || !record.matrix) return true;
  if (!stationaryStyle(style)) return false;
  const actual = computedMatrix(style.transform);
  if (!actual) return false;
  return record.matrix.every((value, index) => {
    const expected = value + (index === 4 ? left : index === 5 ? top : 0);
    // A conservative serialization tolerance may choose the ordinary renderer for large rounded CSS coefficients.
    return Math.abs(actual[index] - expected) <= (index < 4 ? 1e-5 : 1e-4);
  });
}

/** Fixed-size Canvas translations retain their last layout origin; full renders own every other style change. */
export class HostCanvasTranslations {
  constructor(host) {
    this.host = host;
    this.records = new Map();
  }

  /** Prepare without mutating DOM or retained state, preserving atomic rejection of a multi-node property batch. */
  prepare(id, previous, next, input) {
    const names = Object.keys(input);
    if (!names.length || names.some(name => name !== 'Left' && name !== 'Top')
      || !Number.isFinite(previous.Width) || !Number.isFinite(previous.Height)
      || next.Width !== previous.Width || next.Height !== previous.Height) return null;
    const element = this.host.elements.get(id);
    const style = this.host.document.defaultView.getComputedStyle?.(element);
    if (!stationaryStyle(style)) return null;
    const retained = this.records.get(id);
    const nextLeft = coordinate(next.Left);
    const nextTop = coordinate(next.Top);
    if (retained) {
      if (style && affineTransform(element, style) === null) return null;
      if (retained.element !== element || retained.applied !== element.style.transform
        || retained.origin !== element.style.transformOrigin || retained.width !== previous.Width || retained.height !== previous.Height) return null;
      return {...retained, nextLeft, nextTop};
    }
    const left = coordinate(previous.Left);
    const top = coordinate(previous.Top);
    if (element.style.position !== 'absolute' || Number.parseFloat(element.style.left) !== left
      || Number.parseFloat(element.style.top) !== top) return null;
    const transform = affineTransform(element, style);
    if (transform === null) return null;
    return {element, left, top, nextLeft, nextTop, transform: transform.text, matrix: transform.matrix,
      inlineTransform: element.style.transform,
      origin: element.style.transformOrigin, applied: element.style.transform, width: previous.Width, height: previous.Height};
  }

  commit(id, prepared) {
    if (prepared) this.records.set(id, prepared);
    else this.records.delete(id);
  }

  /** Translation precedes the existing affine transform, so its offset is in the Canvas parent's coordinate system. */
  render(id) {
    const record = this.records.get(id);
    if (!record) return false;
    const left = record.nextLeft - record.left;
    const top = record.nextTop - record.top;
    record.element.style.transform = left || top
      ? `translate(${left}px, ${top}px)${record.transform ? ' ' + record.transform : ''}` : record.inlineTransform;
    const style = this.host.document.defaultView.getComputedStyle?.(record.element);
    if (!effectiveTranslation(style, record, left, top)) {
      this.records.delete(id);
      return false;
    }
    record.applied = record.element.style.transform;
    return true;
  }

  clear() { this.records.clear(); }
}
