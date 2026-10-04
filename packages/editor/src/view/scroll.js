/** Browser scrolling with custom accessible thumbs and bounded logical-to-physical extent. */
export class EditorScroll {
  constructor(view) {
    this.view = view;
    this.knownWidths = new Map();
    this.extent = 0;
    this.scale = 1;
    this.vertical = this.createBar('vertical');
    this.horizontal = this.createBar('horizontal');
    this.onScroll = () => view.schedule();
    view.viewport.addEventListener('scroll', this.onScroll, {passive: true});
    this.onWheel = event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      view.editor.setZoom(view.editor.options.zoom + (event.deltaY < 0 ? 10 : -10));
    };
    view.viewport.addEventListener('wheel', this.onWheel, {passive: false});
  }

  createBar(orientation) {
    const {view} = this;
    const element = view.document.createElement('div');
    element.className = `sf-scrollbar sf-scrollbar-${orientation}`;
    element.tabIndex = 0;
    element.setAttribute('role', 'scrollbar');
    element.setAttribute('aria-label', `${orientation} editor scroll`);
    element.setAttribute('aria-orientation', orientation);
    element.setAttribute('aria-valuemin', '0');
    const thumb = view.document.createElement('div');
    thumb.className = 'sf-scroll-thumb';
    element.append(thumb);
    view.editor.element.append(element);
    const vertical = orientation === 'vertical';
    element.addEventListener('pointerdown', event => {
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      const update = move => {
        const rect = element.getBoundingClientRect();
        const ratio = vertical ? (move.clientY - rect.top) / rect.height : (move.clientX - rect.left) / rect.width;
        const maximum = vertical ? view.viewport.scrollHeight - view.viewport.clientHeight : view.viewport.scrollWidth - view.viewport.clientWidth;
        if (vertical) view.scrollTo({top: Math.max(0, Math.min(maximum, ratio * maximum)) * this.scale});
        else view.viewport.scrollLeft = Math.max(0, Math.min(maximum, ratio * maximum));
      };
      update(event);
      element.addEventListener('pointermove', update);
      element.addEventListener('pointerup', () => element.removeEventListener('pointermove', update), {once: true});
    });
    element.addEventListener('keydown', event => {
      const distance = event.key.startsWith('Page') ? view.viewport.clientHeight : view.metrics.lineHeight;
      const direction = ['ArrowDown', 'ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1;
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].includes(event.key)) return;
      event.preventDefault();
      if (vertical) view.scrollTo({top: view.scrollTop + direction * distance});
      else view.viewport.scrollLeft += direction * distance;
    });
    return {element, thumb, vertical};
  }

  update(rows) {
    const {view} = this;
    for (const row of rows) {
      const width = row.record.length > view.editor.options.maxRenderedLineCharacters
        ? row.record.length * view.metrics.charWidth : row.record.layout.width;
      this.knownWidths.set(row.line, width);
      this.extent = Math.max(this.extent, width);
    }
    const height = (view.layout.map.rowCount + view.layout.leadingRows) * view.metrics.lineHeight + view.editor.padding * 2;
    const extra = view.editor.options.scrollPastEnd ? view.viewport.clientHeight * 0.75 : 0;
    const logical = Math.max(view.viewport.clientHeight, height + extra);
    const physical = Math.min(16_000_000, logical);
    const previousTop = view.scrollTop;
    this.scale = Math.max(1, (logical - view.viewport.clientHeight) / Math.max(1, physical - view.viewport.clientHeight));
    view.surface.style.height = `${physical}px`;
    const physicalTop = previousTop / this.scale;
    if (Math.abs(view.viewport.scrollTop - physicalTop) > 0.5) view.viewport.scrollTop = physicalTop;
    const width = view.editor.options.wordWrap ? view.viewport.clientWidth : this.extent + view.editor.padding * 2;
    view.surface.style.width = `${Math.max(view.viewport.clientWidth, width)}px`;
    for (const bar of [this.vertical, this.horizontal]) {
      const viewport = bar.vertical ? view.viewport.clientHeight : view.viewport.clientWidth;
      const extent = bar.vertical ? view.viewport.scrollHeight : view.viewport.scrollWidth;
      const offset = bar.vertical ? view.viewport.scrollTop : view.viewport.scrollLeft;
      const percent = Math.min(100, Math.max(4, viewport / Math.max(1, extent) * 100));
      bar.thumb.style[bar.vertical ? 'height' : 'width'] = `${percent}%`;
      bar.thumb.style[bar.vertical ? 'top' : 'left'] = `${offset / Math.max(1, extent - viewport) * (100 - percent)}%`;
      bar.element.setAttribute('aria-valuemax', String(Math.max(0, extent - viewport)));
      bar.element.setAttribute('aria-valuenow', String(Math.round(offset)));
    }
  }

  invalidate(change) {
    for (const edit of change.changes) {
      const line = edit.range?.start.line ?? change.before.positionAt(edit.start).line;
      this.knownWidths.delete(line);
    }
    if (this.knownWidths.size > 8192) this.knownWidths.clear();
    this.extent = Math.max(0, ...this.knownWidths.values());
  }

  reset() { this.knownWidths.clear(); this.extent = 0; }
  dispose() {
    this.view.viewport.removeEventListener('scroll', this.onScroll);
    this.view.viewport.removeEventListener('wheel', this.onWheel);
    this.vertical.element.remove();
    this.horizontal.element.remove();
    this.knownWidths.clear();
  }
}
