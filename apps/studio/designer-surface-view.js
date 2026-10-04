import {TreeModel, TreeView} from '@sharpforge/controls';
import {DesignDocument, childSlot} from '@sharpforge/designer';

const zoomSteps = [25, 50, 67, 80, 100, 125, 150, 200];

/** Initial controls are moved, with their handlers intact, into the document's single command bar. */
export function mountDesignerSurface(view) {
  const panel = view.panel('designer');
  panel.classList.add('sf-design-tool');
  panel.innerHTML = `
    <div class="panel-tools design-toolbar">
      <button data-design-action="new">New</button><button data-design-action="open">Open</button>
      <button data-design-action="save">Save</button><button data-design-action="download">Export JSON</button>
      <button data-design-action="undo" title="Undo (Ctrl+Z)">↶</button>
      <button data-design-action="redo" title="Redo (Ctrl+Y)">↷</button>
      <select id="designer-mode" aria-label="Designer editing mode">
        <option value="pixel">Pixel editing</option><option value="layout">Layout editing</option>
      </select>
      <label>Snap <input id="designer-snap" type="number" min="1" max="64" value="8"></label>
      <select id="designer-zoom" aria-label="Artboard zoom">
        ${zoomSteps.map(value => `<option value="${value}" ${value === 80 ? 'selected' : ''}>${value}%</option>`).join('')}
      </select>
      <button data-design-action="fit">Fit</button><button data-design-action="preview">Preview</button>
    </div>
    <div class="panel-tools design-toolbar">
      <button data-design-action="attach">Attach running app</button><button data-design-action="apply">Apply to live</button>
      <button data-design-action="run-app">Run another app</button>
      <button data-design-action="generate">Build &amp; Run C#</button><button data-design-action="source">View Code</button>
      <button data-design-action="options">Options</button>
      <label>W <input id="designer-width" type="number" min="100" max="10000" value="960"></label>
      <label>H <input id="designer-height" type="number" min="100" max="10000" value="640"></label>
      <select id="designer-backend" aria-label="Preview renderer">
        <option value="auto">Auto renderer</option><option value="dom">DOM</option>
        <option value="canvas2d">Canvas2D</option><option value="webgpu">WebGPU + fallback</option>
      </select>
    </div>
    <div class="design-scroll" tabindex="0" aria-label="WinUI design surface">
      <div class="design-ruler horizontal"></div><div class="design-ruler vertical"></div>
      <div class="design-size"><div class="design-stage">
        <div class="design-preview"></div><div class="design-overlay"></div>
      </div></div>
    </div><div class="design-status" role="status"></div>`;
  for (const [name, selector] of Object.entries({stage: '.design-stage', previewRoot: '.design-preview',
    overlay: '.design-overlay', scroller: '.design-scroll', statusElement: '.design-status'})) {
    view[name] = panel.querySelector(selector);
  }
  for (const button of panel.querySelectorAll('[data-design-action]')) {
    button.onclick = () => view.safe(() => view.action(button.dataset.designAction));
  }
  panel.querySelector('#designer-mode').onchange = event => {
    view.mode = event.target.value;
    view.drawAdorners();
  };
  panel.querySelector('#designer-zoom').onchange = event => {
    view.zoom = Number(event.target.value) / 100;
    view.resizeArtboard();
  };
  panel.querySelector('#designer-backend').onchange = event => view.host.setBackend(event.target.value);
  for (const [selector, property] of [['#designer-width', 'width'], ['#designer-height', 'height']]) {
    panel.querySelector(selector).onchange = event => view.safe(() => view.document.change('Resize artboard', design => {
      design[property] = Number(event.target.value);
    }));
  }
  for (const id of ['designer-toolbox', 'designer-tree', 'designer-properties', 'designer-layout', 'designer-styles', 'designer-source']) {
    view.panel(id)?.classList.add('design-side');
  }
  mountDesignerTree(view);
}

function mountDesignerTree(view) {
  const panel = view.panel('designer-tree');
  panel.innerHTML = `<div class="panel-tools"><b>Document outline</b>
    <button data-tree-up title="Move up">↑</button><button data-tree-down title="Move down">↓</button>
    <button data-tree-delete title="Delete">×</button></div>
    <input aria-label="Search visual tree" placeholder="Search visual tree"><div class="design-tree"></div>`;
  view.treeModel = new TreeModel();
  view.treeView = new TreeView(panel.querySelector('.design-tree'), {
    model: view.treeModel, label: 'WinUI visual tree',
    onSelect: nodes => {
      if (view.syncing) return;
      const ids = nodes.length ? nodes.map(node => node.id) : [view.document.value.root];
      view.document.select(view.outline?.filterSelection?.(ids) ?? ids);
    },
    onOpen: node => {
      view.document.select(node.id);
      view.docking.activate('designer-properties');
    },
    onContextMenu: ({event, x, y, anchor, node}) => {
      if (node && !view.document.selection.includes(node.id)) view.document.select(node.id);
      view.context({clientX: x ?? event.clientX, clientY: y ?? event.clientY, target: anchor ?? event.target});
    },
    onCommand: command => view.safe(() => view.action(command)),
    onDrop: (nodes, target, {copy}) => view.safe(() => moveTreeSelection(view, nodes, target, copy)),
    onError: error => view.error(error)
  });
  panel.querySelector('input').oninput = event => view.treeModel.setFilter(event.target.value);
  panel.querySelector('[data-tree-up]').onclick = () => view.safe(() => view.reorder(-1));
  panel.querySelector('[data-tree-down]').onclick = () => view.safe(() => view.reorder(1));
  panel.querySelector('[data-tree-delete]').onclick = () => view.safe(() => view.action('delete'));
}

function moveTreeSelection(view, nodes, target, duplicate) {
  view.outline?.assertEditable(nodes.map(node => node.id));
  view.outline?.assertEditable([target.id]);
  if (!childSlot(view.document.node(target.id)?.type)) throw new Error('Choose a control that accepts children');
  const candidate = new DesignDocument(view.document.value);
  try {
    const ids = nodes.map(node => duplicate ? candidate.duplicate(node.id) : node.id);
    for (const id of ids) candidate.move(id, target.id);
    view.document.change('Move visual tree selection', design => Object.assign(design, candidate.snapshot()));
    view.document.select(ids);
  } finally { candidate.dispose(); }
}

export function resizeDesignerArtboard(view) {
  const design = view.document.value;
  for (const element of [view.stage, view.previewRoot]) {
    element.style.width = design.width + 'px';
    element.style.height = design.height + 'px';
  }
  view.stage.style.transform = `scale(${view.zoom})`;
  const select = view.controlsRoot.querySelector('#designer-zoom');
  const percent = Math.round(view.zoom * 100);
  select.querySelector('[data-custom]')?.remove();
  if (![...select.options].some(option => Number(option.value) === percent)) {
    const option = select.ownerDocument.createElement('option');
    option.value = String(percent);
    option.textContent = percent + '%';
    option.dataset.custom = 'true';
    select.append(option);
  }
  select.value = String(percent);
  view.stage.parentElement.style.width = design.width * view.zoom + 'px';
  view.stage.parentElement.style.height = design.height * view.zoom + 'px';
  view.controlsRoot.querySelector('#designer-width').value = design.width;
  view.controlsRoot.querySelector('#designer-height').value = design.height;
  view.controlsRoot.querySelector('#designer-mode').value = view.mode;
  view.stage.classList.toggle('interactive', view.preview);
}
