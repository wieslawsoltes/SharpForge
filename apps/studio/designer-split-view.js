/** Keeps both editor and design DOM mounted. Only this document's flex ratio changes; the dock model is never touched. */
export class DesignerSplitView {
  constructor({session, designPane, codePane, onResize = () => {}, beforeLayout = () => {}}) {
    this.session = session;
    this.designPane = designPane;
    this.codePane = codePane;
    this.onResize = onResize;
    this.beforeLayout = beforeLayout;
    this.disposed = false;
    this.cleanup = [];
    const document = designPane.ownerDocument;
    this.element = document.createElement('div');
    this.element.className = 'designer-document-panes';
    designPane.classList.add('designer-document-design');
    codePane.classList.add('designer-document-code');
    this.splitter = document.createElement('div');
    this.splitter.className = 'designer-document-splitter';
    this.splitter.tabIndex = 0;
    this.splitter.setAttribute('role', 'separator');
    this.splitter.setAttribute('aria-label', 'Resize design and code panes');
    this.splitter.setAttribute('aria-valuemin', '10');
    this.splitter.setAttribute('aria-valuemax', '90');
    this.element.append(designPane, this.splitter, codePane);
    this.listen(this.splitter, 'pointerdown', event => this.pointerDown(event));
    this.listen(this.splitter, 'keydown', event => this.keydown(event));
    this.listen(this.splitter, 'dblclick', () => this.session.setViewState({ratio: .5}));
    this.unsubscribe = session.subscribe(event => {
      const layoutChanged = event.changed?.some(key => ['mode', 'orientation', 'ratio', 'swapped', 'collapsed'].includes(key));
      if (event.kind === 'restore' || event.kind === 'view' && layoutChanged) this.render();
    });
    const Observer = document.defaultView?.ResizeObserver;
    if (Observer) {
      this.observer = new Observer(() => this.onResize());
      this.observer.observe(this.element);
    }
    this.render();
  }

  listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this.cleanup.push(() => target.removeEventListener(type, callback, options));
  }

  render() {
    const {mode, orientation, ratio, swapped, collapsed} = this.session.viewState;
    this.element.dataset.mode = mode;
    this.element.dataset.orientation = orientation;
    this.element.dataset.swapped = String(swapped);
    const split = mode === 'split' && !collapsed;
    this.beforeLayout(mode !== 'design' && !(mode === 'split' && collapsed === 'code'));
    this.designPane.hidden = mode === 'code' || mode === 'split' && collapsed === 'design';
    this.codePane.hidden = mode === 'design' || mode === 'split' && collapsed === 'code';
    this.splitter.hidden = !split;
    this.designPane.style.order = swapped ? '2' : '0';
    this.splitter.style.order = '1';
    this.codePane.style.order = swapped ? '0' : '2';
    this.designPane.style.flex = split ? `${ratio} 1 0%` : '1 1 0%';
    this.codePane.style.flex = split ? `${1 - ratio} 1 0%` : '1 1 0%';
    this.splitter.setAttribute('aria-orientation', orientation);
    this.splitter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    this.splitter.setAttribute('aria-valuetext', `${Math.round(ratio * 100)}% design, ${Math.round((1 - ratio) * 100)}% code`);
    this.onResize();
  }

  keydown(event) {
    const {orientation, ratio, swapped} = this.session.viewState;
    const backward = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const forward = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    if (![backward, forward, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? .1 : .02;
    let next = ratio + (event.key === forward ? step : -step) * (swapped ? -1 : 1);
    if (event.key === 'Home') next = .1;
    if (event.key === 'End') next = .9;
    this.session.setViewState({ratio: next});
  }

  pointerDown(event) {
    if (event.button !== 0 || this.splitter.hidden) return;
    event.preventDefault();
    this.cancelDrag?.();
    const document = this.element.ownerDocument;
    const startRatio = this.session.viewState.ratio;
    const pointerId = event.pointerId;
    const move = current => {
      if (current.pointerId !== pointerId) return;
      const bounds = this.element.getBoundingClientRect();
      const {orientation, swapped} = this.session.viewState;
      const extent = orientation === 'vertical' ? bounds.width : bounds.height;
      if (extent <= 0) return;
      const coordinate = orientation === 'vertical' ? current.clientX - bounds.left : current.clientY - bounds.top;
      const fraction = coordinate / extent;
      this.session.setViewState({ratio: swapped ? 1 - fraction : fraction});
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', escape);
      this.cancelDrag = null;
      this.element.classList.remove('resizing');
    };
    const end = current => { if (current.pointerId === pointerId) cleanup(); };
    const cancel = current => {
      if (current && current.pointerId !== pointerId) return;
      cleanup();
      if (!this.session.disposed) this.session.setViewState({ratio: startRatio});
    };
    const escape = current => {
      if (current.key === 'Escape') { current.preventDefault(); cancel(); }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', escape);
    this.cancelDrag = cancel;
    this.element.classList.add('resizing');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelDrag?.();
    this.unsubscribe();
    this.observer?.disconnect();
    for (const cleanup of this.cleanup.splice(0)) cleanup();
  }
}
