import {geometryInvariant, guideSettings, setUserGuide} from '@sharpforge/designer';

export class DesignerUserGuides {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.listeners = [];
  }

  install() {
    for (const [className, axis] of [['horizontal', 'x'], ['vertical', 'y']]) {
      const ruler = this.view.panel('designer').querySelector(`.design-ruler.${className}`);
      if (!ruler) continue;
      ruler.style.pointerEvents = 'auto';
      ruler.setAttribute('aria-label', axis === 'x' ? 'Drag a vertical guide from the ruler' : 'Drag a horizontal guide from the ruler');
      const start = event => this.drag(event, {axis});
      ruler.addEventListener('pointerdown', start);
      this.listeners.push(() => ruler.removeEventListener('pointerdown', start));
    }
  }

  drag(event, {axis, id = null, position = null}) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const revision = this.view.document.revision;
    let next = position;
    this.controller.trackPointer(event, pointer => {
      const point = this.controller.geometry.stagePoint({x: pointer.clientX, y: pointer.clientY});
      next = axis === 'x' ? point.x : point.y;
      this.render([{id: id ?? '$preview', axis, position: next}]);
    }, () => {
      this.render();
      geometryInvariant(revision === this.view.document.revision, 'SFD_GUIDE_STALE', 'The document changed while moving this guide.');
      if (next !== null) setUserGuide(this.view.document, {id, axis, position: next});
    }, () => this.render());
  }

  render(preview = []) {
    const view = this.view;
    view.overlay.querySelector('[data-user-guides]')?.remove();
    const settings = guideSettings(view.document.value);
    view.snap = settings.gridSize;
    view.scroller.style.backgroundSize = `${settings.gridSize * view.zoom}px ${settings.gridSize * view.zoom}px`;
    view.scroller.style.backgroundImage = settings.gridVisible ? 'radial-gradient(#6e7885 .6px,transparent .6px)' : 'none';
    if (view.preview) return;
    const group = view.overlay.ownerDocument.createElement('div');
    group.dataset.userGuides = '';
    const guides = settings.guides.filter(guide => !preview.some(item => item.id === guide.id)).concat(preview);
    for (const guide of guides) {
      const line = group.ownerDocument.createElement('button');
      line.type = 'button';
      line.dataset.userGuide = guide.id;
      line.setAttribute('aria-label', `${guide.axis === 'x' ? 'Vertical' : 'Horizontal'} guide at ${guide.position.toFixed(1)} pixels`);
      line.title = 'Drag to reposition; double-click or Delete to remove';
      Object.assign(line.style, {position: 'absolute', padding: '0', minWidth: '0', minHeight: '0',
        pointerEvents: 'auto', border: '0', background: '#b98aff99', zIndex: '20'});
      Object.assign(line.style, guide.axis === 'x'
        ? {left: `${guide.position}px`, top: '0', height: `${view.document.value.height}px`, width: '3px', cursor: 'col-resize'}
        : {left: '0', top: `${guide.position}px`, width: `${view.document.value.width}px`, height: '3px', cursor: 'row-resize'});
      line.onpointerdown = event => this.drag(event, guide);
      line.ondblclick = () => setUserGuide(view.document, {...guide, remove: true});
      line.onkeydown = event => {
        if (event.key === 'Delete') {
          event.preventDefault();
          event.stopPropagation();
          setUserGuide(view.document, {...guide, remove: true});
        }
      };
      group.append(line);
    }
    view.overlay.append(group);
  }

  dispose() {
    for (const dispose of this.listeners.splice(0)) dispose();
    this.view.overlay?.querySelector('[data-user-guides]')?.remove();
  }
}
