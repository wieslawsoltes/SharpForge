import {element} from '../ui.js';

/** Fixed-row virtual grid: O(visible rows * columns) DOM, preserving selection by stable id. */
export class VirtualTable {
  constructor(host, {columns, rows = [], key = row => row.id, onActivate = () => {}, onSelect = () => {}, rowHeight = 28,
    label = 'Results', overscan = 8, format = (row, column) => row[column.id] ?? ''} = {}) {
    this.host = host;
    this.document = host.ownerDocument;
    this.columns = columns;
    this.rows = rows;
    this.key = key;
    this.onActivate = onActivate;
    this.onSelect = onSelect;
    this.rowHeight = rowHeight;
    this.overscan = overscan;
    this.format = format;
    this.index = rows.length ? 0 : -1;
    this.dataRevision = 0;
    this.columnRevision = 0;
    this.controller = new AbortController();
    this.root = element(this.document, 'div', {className: 'wb-grid', role: 'grid', tabIndex: 0, 'aria-label': label});
    this.header = element(this.document, 'div', {className: 'wb-grid-header', role: 'row'});
    this.viewport = element(this.document, 'div', {className: 'wb-grid-viewport'});
    this.spacer = element(this.document, 'div', {className: 'wb-grid-spacer'});
    this.body = element(this.document, 'div', {className: 'wb-grid-body'});
    this.viewport.append(this.spacer, this.body);
    this.root.append(this.header, this.viewport);
    host.append(this.root);
    this.viewport.addEventListener('scroll', () => this.render(), {signal: this.controller.signal});
    this.root.addEventListener('keydown', event => this.keyDown(event), {signal: this.controller.signal});
    this.observer = globalThis.ResizeObserver ? new ResizeObserver(() => this.render()) : null;
    this.observer?.observe(this.viewport);
    this.renderHeader();
    this.setRows(rows);
  }
  template() { return this.columns.map(column => column.width ?? 'minmax(100px, 1fr)').join(' '); }
  renderHeader() {
    this.header.replaceChildren();
    this.header.style.gridTemplateColumns = this.template();
    for (const column of this.columns) {
      this.header.append(element(this.document, 'div', {role: 'columnheader', text: column.title}));
    }
  }
  setColumns(columns) { this.columns = columns; this.columnRevision++; this.renderHeader(); this.render(); }
  setRows(rows) {
    const selected = this.rows[this.index];
    this.rows = rows;
    this.dataRevision++;
    const previous = selected ? rows.findIndex(row => this.key(row) === this.key(selected)) : -1;
    this.index = rows.length ? previous >= 0 ? previous : Math.min(Math.max(0, this.index), rows.length - 1) : -1;
    this.root.setAttribute('aria-rowcount', String(rows.length + 1));
    this.root.setAttribute('aria-colcount', String(this.columns.length));
    this.spacer.style.height = rows.length * this.rowHeight + 'px';
    this.render();
  }
  select(index, {reveal = true} = {}) {
    if (!this.rows.length) return;
    this.index = Math.max(0, Math.min(this.rows.length - 1, index));
    if (reveal) {
      const top = this.index * this.rowHeight;
      const bottom = top + this.rowHeight;
      if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
      else if (bottom > this.viewport.scrollTop + this.viewport.clientHeight) {
        this.viewport.scrollTop = bottom - (this.viewport.clientHeight || 280);
      }
    }
    this.render();
    this.onSelect(this.rows[this.index], this.index);
  }
  keyDown(event) {
    const page = Math.max(1, Math.floor((this.viewport.clientHeight || 280) / this.rowHeight));
    const actions = {ArrowDown: this.index + 1, ArrowUp: this.index - 1, PageDown: this.index + page,
      PageUp: this.index - page, Home: 0, End: this.rows.length - 1};
    if (Object.hasOwn(actions, event.key)) { event.preventDefault(); this.select(actions[event.key]); }
    if (event.key === 'Enter' && this.index >= 0) { event.preventDefault(); this.onActivate(this.rows[this.index]); }
  }
  render() {
    const start = Math.max(0, Math.floor(this.viewport.scrollTop / this.rowHeight) - this.overscan);
    const count = Math.ceil((this.viewport.clientHeight || 280) / this.rowHeight) + this.overscan * 2;
    const end = Math.min(this.rows.length, start + count);
    const windowKey = `${start}:${end}:${this.dataRevision}:${this.columnRevision}`;
    if (windowKey === this.windowKey) {
      for (const row of this.body.children) row.setAttribute('aria-selected', String(Number(row.dataset.rowIndex) === this.index));
      return;
    }
    this.windowKey = windowKey;
    this.body.style.transform = `translateY(${start * this.rowHeight}px)`;
    this.body.replaceChildren();
    for (let index = start; index < end; index++) {
      const data = this.rows[index];
      const row = element(this.document, 'div', {className: 'wb-grid-row', role: 'row',
        'aria-rowindex': index + 2, 'aria-selected': index === this.index, 'data-row-key': this.key(data), 'data-row-index': index});
      row.style.height = this.rowHeight + 'px';
      row.style.gridTemplateColumns = this.template();
      for (const column of this.columns) {
        const cell = element(this.document, 'div', {role: 'gridcell'});
        if (column.render) column.render(cell, data);
        else cell.textContent = this.format(data, column);
        row.append(cell);
      }
      row.addEventListener('click', () => { this.select(index, {reveal: false}); this.root.focus(); });
      row.addEventListener('dblclick', () => this.onActivate(data));
      this.body.append(row);
    }
  }
  dispose() { this.controller.abort(); this.observer?.disconnect(); this.root.remove(); }
}
