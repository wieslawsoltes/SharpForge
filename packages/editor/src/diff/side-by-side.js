import {node, button, WidgetLifetime} from '../widgets/dom.js';
import {buildDiffRows} from './rows.js';

export class SideBySideDiff {
  constructor(element, options = {}) {
    this.element = element;
    this.options = options;
    this.document = element.ownerDocument;
    this.lifetime = new WidgetLifetime();
    this.lineHeight = options.lineHeight ?? 22;
    this.current = -1;
    element.classList.add('sf-diff-editor');
    element.tabIndex = 0;
    const toolbar = node(this.document, 'div', {className: 'sf-diff-toolbar'});
    this.status = node(this.document, 'span', {role: 'status', 'aria-live': 'polite'});
    toolbar.append(button(this.document, 'Previous difference', () => this.next(-1)),
      button(this.document, 'Next difference', () => this.next(1)), this.status);
    this.body = node(this.document, 'div', {className: 'sf-diff-panes'});
    this.left = this.pane(options.originalLabel ?? 'Original');
    this.right = this.pane(options.modifiedLabel ?? 'Modified');
    this.overview = node(this.document, 'div', {className: 'sf-diff-overview', 'aria-label': 'Difference overview'});
    this.body.append(this.left.container, this.right.container, this.overview);
    element.append(toolbar, this.body);
    this.lifetime.listen(this.left.scroll, 'scroll', () => this.scrolled(this.left, this.right));
    this.lifetime.listen(this.right.scroll, 'scroll', () => this.scrolled(this.right, this.left));
    this.lifetime.listen(element, 'keydown', event => {
      if (event.key !== 'F8') return;
      event.preventDefault();
      this.next(event.shiftKey ? -1 : 1);
    });
    this.setValue(options.original ?? '', options.modified ?? '');
  }

  pane(label) {
    const container = node(this.document, 'section', {className: 'sf-diff-pane', 'aria-label': label});
    const scroll = node(this.document, 'div', {className: 'sf-diff-scroll', tabindex: 0});
    const content = node(this.document, 'div', {className: 'sf-diff-content'});
    scroll.append(content);
    container.append(node(this.document, 'header', {}, label), scroll);
    return {container, scroll, content};
  }

  setValue(original, modified) {
    this.original = original;
    this.modified = modified;
    this.result = buildDiffRows(original, modified, this.options.diff?.(original, modified));
    this.current = -1;
    this.overview.replaceChildren();
    for (const [index, hunk] of this.result.hunks.entries()) {
      const mark = button(this.document, '', () => this.goTo(index), {'aria-label': `Difference ${index + 1}`, className: 'sf-diff-mark'});
      mark.style.top = `${hunk.row / this.result.rows.length * 100}%`;
      mark.style.height = `${Math.max(0.5, hunk.rows / this.result.rows.length * 100)}%`;
      this.overview.append(mark);
    }
    this.render();
    this.announce();
  }

  scrolled(source, target) {
    if (target.scroll.scrollTop !== source.scroll.scrollTop) target.scroll.scrollTop = source.scroll.scrollTop;
    if (this.options.synchronizeHorizontal && target.scroll.scrollLeft !== source.scroll.scrollLeft) {
      target.scroll.scrollLeft = source.scroll.scrollLeft;
    }
    this.render();
  }

  render() {
    const top = this.left.scroll.scrollTop;
    const height = this.left.scroll.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / this.lineHeight) - 4);
    const last = Math.min(this.result.rows.length, first + Math.ceil(height / this.lineHeight) + 8);
    this.paintPane(this.left, 'original', first, last);
    this.paintPane(this.right, 'modified', first, last);
  }

  paintPane(pane, side, first, last) {
    pane.content.style.height = `${this.result.rows.length * this.lineHeight}px`;
    const rows = [];
    for (let index = first; index < last; index++) {
      const entry = this.result.rows[index];
      const line = entry[side];
      const kind = entry.kind === 'equal' ? 'equal' : line ? side === 'original' ? 'deleted' : 'inserted' : 'padding';
      const row = node(this.document, 'div', {className: `sf-diff-row sf-diff-${kind}`});
      row.style.top = `${index * this.lineHeight}px`;
      row.style.height = `${this.lineHeight}px`;
      row.append(node(this.document, 'span', {className: 'sf-diff-line-number', 'aria-hidden': true}, line?.line ?? ''),
        node(this.document, 'code', {}, line?.text ?? ''));
      rows.push(row);
    }
    pane.content.replaceChildren(...rows);
  }

  goTo(index) {
    if (!this.result.hunks.length) return null;
    this.current = (index + this.result.hunks.length) % this.result.hunks.length;
    const hunk = this.result.hunks[this.current];
    this.left.scroll.scrollTop = hunk.row * this.lineHeight;
    this.right.scroll.scrollTop = this.left.scroll.scrollTop;
    this.render();
    this.announce();
    this.options.onNavigate?.(hunk, this.current);
    return hunk;
  }

  next(direction = 1) { return this.goTo(this.current < 0 ? direction < 0 ? this.result.hunks.length - 1 : 0 : this.current + direction); }

  announce() {
    const limited = this.result.timedOut || this.result.truncated ? ' · diff limit reached' : '';
    this.status.textContent = `${this.result.hunks.length} differences${this.current < 0 ? '' : ` · ${this.current + 1} selected`}${limited}`;
  }

  dispose() { this.lifetime.dispose(); this.element.replaceChildren(); }
}

export function createSideBySideDiff(element, options) { return new SideBySideDiff(element, options); }
