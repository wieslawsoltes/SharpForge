/** Native layout is the bidi reference: DOM Range exposes UAX #9 shaped visual rectangles. */
export class BidiGeometry {
  constructor(document) { this.document = document; }

  point(row, offset) {
    const nodes = textNodes(row);
    let remaining = offset;
    for (const node of nodes) {
      if (remaining <= node.length) return {node, offset: remaining};
      remaining -= node.length;
    }
    const node = nodes.at(-1);
    return node ? {node, offset: node.length} : null;
  }

  rectangles(row, start, end) {
    const from = this.point(row, start);
    const to = this.point(row, end);
    if (!from || !to) return [];
    const range = this.document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return Array.from(range.getClientRects(), rect => ({left: rect.left, top: rect.top, width: rect.width, height: rect.height}));
  }

  caret(row, offset) {
    const rectangles = this.rectangles(row, offset, offset);
    if (rectangles[0]?.height) return rectangles[0];
    const next = this.rectangles(row, offset, offset + (offset < row.textContent.length ? 1 : 0));
    return next[0] ?? null;
  }

  visualMove(row, offset, direction, boundaries) {
    const candidates = boundaries.map(value => ({offset: value, rect: this.caret(row, value)})).filter(item => item.rect);
    candidates.sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left || left.offset - right.offset);
    const index = candidates.findIndex(item => item.offset === offset);
    return candidates[Math.max(0, Math.min(candidates.length - 1, index + direction))]?.offset ?? offset;
  }
}

function textNodes(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[data-decoration-only]')) nodes.push(node);
  }
  return nodes;
}

export function hasBidi(text) { return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(text); }
