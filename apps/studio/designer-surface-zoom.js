import {anchoredDesignZoom, fitDesignBounds} from '@sharpforge/designer';

export class DesignerSurfaceZoom {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.space = false;
    this.listeners = [];
  }

  viewport() {
    const view = this.view;
    const box = view.scroller.getBoundingClientRect();
    const stage = view.stage.getBoundingClientRect();
    return {width: view.scroller.clientWidth, height: view.scroller.clientHeight, zoom: view.zoom,
      scrollLeft: view.scroller.scrollLeft, scrollTop: view.scroller.scrollTop,
      originX: stage.left - box.left + view.scroller.scrollLeft,
      originY: stage.top - box.top + view.scroller.scrollTop};
  }

  apply(next) {
    this.view.zoom = next.zoom;
    this.view.resizeArtboard();
    this.view.scroller.scrollLeft = Math.max(0, next.scrollLeft);
    this.view.scroller.scrollTop = Math.max(0, next.scrollTop);
    this.controller.geometry.invalidate();
    this.controller.drawAdorners();
  }

  set(zoom, point = null) {
    const viewport = this.viewport();
    this.apply(anchoredDesignZoom(viewport, point ?? {x: viewport.width / 2, y: viewport.height / 2}, zoom));
  }

  fit(bounds) {
    this.apply(fitDesignBounds(this.viewport(), bounds));
  }

  install() {
    const view = this.view;
    const listen = (element, type, listener, options) => {
      element.addEventListener(type, listener, options);
      this.listeners.push(() => element.removeEventListener(type, listener, options));
    };
    const select = (view.controlsRoot ?? view.panel('designer')).querySelector('#designer-zoom');
    if (select) {
      select.replaceChildren(...[10, 25, 50, 67, 80, 100, 125, 150, 200, 400, 800].map(percent => {
        const option = select.ownerDocument.createElement('option');
        option.value = String(percent);
        option.textContent = `${percent}%`;
        return option;
      }));
      select.value = String(view.zoom * 100);
      select.onchange = () => this.set(Number(select.value) / 100);
    }
    listen(view.scroller, 'wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = view.scroller.getBoundingClientRect();
      this.set(view.zoom * Math.exp(-event.deltaY * .002), {x: event.clientX - box.left, y: event.clientY - box.top});
    }, {passive: false});
    listen(view.scroller, 'keydown', event => {
      if (event.target.matches('input,textarea,select,[contenteditable=true]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        this.space = true;
        view.scroller.style.cursor = 'grab';
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault();
        event.stopPropagation();
        this.controller.fitAll();
      }
    });
    const release = () => {
      this.space = false;
      view.scroller.style.cursor = '';
    };
    listen(view.stage.ownerDocument, 'keyup', event => { if (event.code === 'Space') release(); });
    listen(view.stage.ownerDocument.defaultView, 'blur', release);
    listen(view.scroller, 'pointerdown', event => {
      if (event.button !== 1 && !(this.space && event.button === 0)) return;
      event.preventDefault();
      event.stopPropagation();
      const initial = {x: event.clientX, y: event.clientY, left: view.scroller.scrollLeft, top: view.scroller.scrollTop};
      view.scroller.style.cursor = 'grabbing';
      this.controller.trackPointer(event, pointer => {
        view.scroller.scrollLeft = initial.left + initial.x - pointer.clientX;
        view.scroller.scrollTop = initial.top + initial.y - pointer.clientY;
      }, () => { release(); this.controller.geometry.viewportChanged(); }, release);
    }, true);
    listen(view.scroller, 'scroll', () => {
      this.controller.geometry.viewportChanged();
      this.controller.drawAdorners();
    }, {passive: true});
  }

  dispose() {
    for (const dispose of this.listeners.splice(0)) dispose();
  }
}
