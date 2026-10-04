import {node, button, WidgetLifetime} from '../widgets/dom.js';
import {buildDiffRows, inlineDiffRows} from './rows.js';

export class InlineDiff {
  constructor(element, options = {}) {
    this.element = element;
    this.options = options;
    this.document = element.ownerDocument;
    this.lifetime = new WidgetLifetime();
    this.lineHeight = options.lineHeight ?? 22;
    this.current = -1;
    element.classList.add('sf-diff-editor', 'sf-inline-diff');
    element.tabIndex = 0;
    const toolbar = node(this.document, 'div', {className: 'sf-diff-toolbar'});
    this.status = node(this.document, 'span', {role: 'status'});
    toolbar.append(button(this.document, 'Previous difference', () => this.next(-1)),
      button(this.document, 'Next difference', () => this.next()), this.status);
    this.scroll = node(this.document, 'div', {className: 'sf-diff-scroll'});
    this.content = node(this.document, 'div', {className: 'sf-diff-content'});
    this.scroll.append(this.content);
    element.append(toolbar, this.scroll);
    this.lifetime.listen(this.scroll, 'scroll', () => this.render());
    this.lifetime.listen(element, 'keydown', event => {
      if (event.key !== 'F8') return;
      event.preventDefault();
      this.next(event.shiftKey ? -1 : 1);
    });
    this.setValue(options.original ?? '', options.modified ?? '');
  }

  setValue(original, modified) {
    this.result = buildDiffRows(original, modified, this.options.diff?.(original, modified));
    this.rows = inlineDiffRows(this.result);
    this.current = -1;
    this.status.textContent = `${this.result.hunks.length} differences`;
    this.render();
  }

  render() {
    const first = Math.max(0, Math.floor(this.scroll.scrollTop / this.lineHeight) - 4);
    const last = Math.min(this.rows.length, first + Math.ceil((this.scroll.clientHeight || 400) / this.lineHeight) + 8);
    this.content.style.height = `${this.rows.length * this.lineHeight}px`;
    const visible = this.rows.slice(first, last).map((entry, offset) => {
      const row = node(this.document, 'div', {className: `sf-diff-row sf-diff-${entry.kind}`});
      row.style.top = `${(first + offset) * this.lineHeight}px`;
      row.style.height = `${this.lineHeight}px`;
      row.append(node(this.document, 'span', {className: 'sf-diff-line-number'}, entry.kind === 'deleted' ? '−' : entry.kind === 'inserted' ? '+' : entry.line),
        node(this.document, 'code', {}, entry.text));
      return row;
    });
    this.content.replaceChildren(...visible);
  }

  next(direction = 1) {
    if (!this.result.hunks.length) return null;
    this.current = this.current < 0 ? direction < 0 ? this.result.hunks.length - 1 : 0 :
      (this.current + direction + this.result.hunks.length) % this.result.hunks.length;
    const row = this.rows.findIndex(entry => entry.hunk === this.current);
    this.scroll.scrollTop = Math.max(0, row) * this.lineHeight;
    this.status.textContent = `${this.current + 1} of ${this.result.hunks.length} differences`;
    this.render();
    return this.result.hunks[this.current];
  }

  dispose() { this.lifetime.dispose(); this.element.replaceChildren(); }
}

export function createInlineDiff(element, options) { return new InlineDiff(element, options); }
