import { gitElement } from './git-dom.js';

const maximumCanvasHeight = 24000000;

/** Map very long files into the browser's finite scroll coordinate range. */
export function virtualRange({ count, rowHeight = 22, scrollTop = 0, viewportHeight = 400, overscan = 6 }) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(rowHeight) || rowHeight <= 0
    || !Number.isSafeInteger(overscan) || overscan < 0 || overscan > 100) {
    throw new RangeError('Invalid virtual row dimensions');
  }
  const viewHeight = Math.max(1, viewportHeight);
  const virtualHeight = count * rowHeight;
  const canvasHeight = Math.min(maximumCanvasHeight, virtualHeight);
  const maximumScroll = Math.max(0, canvasHeight - viewHeight);
  const physicalScroll = Math.min(maximumScroll, Math.max(0, scrollTop));
  const logicalScroll = maximumScroll ? physicalScroll * Math.max(0, virtualHeight - viewHeight) / maximumScroll : 0;
  const start = Math.max(0, Math.floor(logicalScroll / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((logicalScroll + viewHeight) / rowHeight) + overscan);
  return { start, end, canvasHeight, offset: physicalScroll - logicalScroll };
}

/** Keep bounded visible rows and eight cached pages; synchronous page results join the current draw. */
export function mountVirtualRows(viewport, { count, rowHeight = 22, overscan = 6, pageSize = 256, loadPage, renderRow,
  initialPage, canvasClass = 'git-diff-canvas', rowClass = 'git-virtual-row', onError = () => {}, signal } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('Invalid virtual page size');
  const document = viewport.ownerDocument;
  const window = document.defaultView;
  const canvas = gitElement(document, 'div', { className: canvasClass });
  const grid = ['table', 'grid', 'treegrid'].includes(viewport.getAttribute('role'));
  const placeholderRole = grid ? 'row' : viewport.getAttribute('role') === 'listbox' ? 'option' : 'listitem';
  const pages = new Map();
  const pending = new Map();
  const failed = new Set();
  let frame = null;
  let disposed = false;
  if (initialPage) pages.set(initialPage.start ?? 0, initialPage.lines ?? initialPage.rows ?? []);
  viewport.replaceChildren(canvas);
  if (grid) viewport.setAttribute('aria-rowcount', String(count));

  const schedule = () => { if (!disposed && frame === null) frame = window.requestAnimationFrame(draw); };
  const storePage = (start, page) => {
    if (disposed) return;
    pages.set(start, page.lines ?? page.rows ?? []);
    while (pages.size > 8) pages.delete(pages.keys().next().value);
  };
  const failPage = (start, error) => {
    if (disposed || signal?.aborted) return;
    failed.add(start);
    onError(error);
  };
  const requestPage = start => {
    if (pages.has(start) || pending.has(start) || failed.has(start) || disposed) return;
    let result;
    try {
      result = loadPage(start, pageSize);
      if (typeof result?.then !== 'function') {
        storePage(start, result);
        return;
      }
    } catch (error) {
      failPage(start, error);
      return;
    }
    const request = Promise.resolve(result).then(page => {
      if (disposed) return;
      storePage(start, page);
      schedule();
    }).catch(error => {
      failPage(start, error);
      schedule();
    }).finally(() => pending.delete(start));
    pending.set(start, request);
  };

  function draw() {
    frame = null;
    if (disposed) return;
    const range = virtualRange({ count, rowHeight, overscan,
      scrollTop: viewport.scrollTop, viewportHeight: viewport.clientHeight || 400 });
    canvas.style.height = `${range.canvasHeight}px`;
    const fragment = document.createDocumentFragment();
    for (let index = range.start; index < range.end; index++) {
      const start = Math.floor(index / pageSize) * pageSize;
      requestPage(start);
      if (disposed) return;
      const page = pages.get(start);
      if (page) { pages.delete(start); pages.set(start, page); }
      let row;
      if (page?.[index - start] !== undefined) row = renderRow(page[index - start], index);
      else {
        row = gitElement(document, 'div', { className: `${rowClass} git-muted`, role: placeholderRole,
          text: failed.has(start) ? 'Unable to load rows. Refresh to retry.' : 'Loading…' });
      }
      row.style.top = `${index * rowHeight + range.offset}px`;
      row.style.height = `${rowHeight}px`;
      row.setAttribute(grid ? 'aria-rowindex' : 'aria-posinset', String(index + 1));
      if (!grid) row.setAttribute('aria-setsize', String(count));
      fragment.append(row);
    }
    canvas.replaceChildren(fragment);
  }

  const observer = new window.ResizeObserver(schedule);
  observer.observe(viewport);
  viewport.addEventListener('scroll', schedule, { passive: true });
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    viewport.removeEventListener('scroll', schedule);
    signal?.removeEventListener('abort', dispose);
    if (frame !== null) window.cancelAnimationFrame(frame);
    pages.clear();
  }
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  draw();
  return { dispose, refresh: draw };
}
