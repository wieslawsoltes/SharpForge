import {childSlot, convertCanvasToGrid, editGridTracks, guideSettings, normalizeProperty, propertySchema, removeResponsiveState,
  resizeGridTracks, setResponsiveState, updateGuideSettings, validateResponsiveDesign} from '@sharpforge/designer';

const formatTrack = value => value.GridUnitType === 0 ? 'Auto' : `${value.Value}${value.GridUnitType === 2 ? '*' : ''}`;

function button(document, label, action, enabled = true) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = !enabled;
  element.onclick = action;
  return element;
}

/** Layout panel composes model operations; all controls commit through the same document APIs. */
export class DesignerLayoutPanel {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.activeState = null;
  }

  section(root, heading) {
    const section = root.ownerDocument.createElement('section');
    const title = root.ownerDocument.createElement('h4');
    title.textContent = heading;
    section.append(title);
    root.append(section);
    return section;
  }

  input(root, label, value, change, {type = 'number', min, max, step = 'any'} = {}) {
    const row = root.ownerDocument.createElement('label');
    const text = root.ownerDocument.createElement('span');
    text.textContent = label;
    const input = root.ownerDocument.createElement('input');
    Object.assign(input, {type, value: value ?? '', step});
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.setAttribute('aria-label', label);
    input.onchange = () => this.view.safe(() => change(type === 'number' ? Number(input.value) : input.value));
    row.append(text, input);
    root.append(row);
    return input;
  }

  render() {
    const root = this.view.panel('designer-layout');
    if (!root || !this.view.initialized) return;
    root.replaceChildren();
    const node = this.view.document.node();
    if (!node) return;
    const arrange = this.section(root, 'Arrange selection');
    for (const [action, label] of [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['top', 'Top'],
      ['middle', 'Middle'], ['bottom', 'Bottom'], ['distribute-h', 'Distribute horizontally'],
      ['distribute-v', 'Distribute vertically'], ['same-width', 'Same width'], ['same-height', 'Same height'], ['same-size', 'Same size']]) {
      arrange.append(button(root.ownerDocument, label, () => this.view.safe(() => this.controller.align(action)),
        this.view.document.selection.length >= (action.startsWith('distribute') ? 3 : 2)));
    }
    this.parents(root, node);
    if (node.type.endsWith('.Canvas')) {
      const conversion = this.section(root, 'Container layout');
      conversion.append(button(root.ownerDocument, 'Convert to Grid', () => this.view.safe(() => this.convertCanvas(node)),
        !this.view.readOnly && !this.view.sourceSync?.session?.analysis?.readOnly && !(this.view.outline?.isLocked(node.id) ?? false)));
    }
    const parent = this.view.document.parent(node.id);
    const grid = node.type.endsWith('.Grid') ? node : parent?.type.endsWith('.Grid') ? parent : null;
    if (grid) {
      this.tracks(root, grid, 'rows');
      this.tracks(root, grid, 'columns');
      if (parent?.id === grid.id) {
        const cell = this.section(root, 'Grid cell');
        for (const key of ['Row', 'Column', 'RowSpan', 'ColumnSpan']) {
          this.input(cell, key, node.properties[key] ?? (key.endsWith('Span') ? 1 : 0),
            value => this.view.document.setProperty(key, value), {min: key.endsWith('Span') ? 1 : 0, step: '1'});
        }
      }
    }
    const margins = this.section(root, 'Margin anchors');
    for (const side of ['left', 'top', 'right', 'bottom']) {
      margins.append(button(root.ownerDocument, `Toggle ${side}`, () => this.view.safe(() => this.controller.anchor(node.id, side)),
        Boolean(parent && !parent.type.endsWith('.Canvas'))));
    }
    this.guides(root);
    this.responsive(root);
  }

  convertCanvas(canvas) {
    const geometry = this.controller.geometry;
    const layoutProperties = ['Left', 'Top', 'Width', 'Height', 'Margin', 'HorizontalAlignment', 'VerticalAlignment'];
    const bindings = this.view.sourceSync?.session?.analysis?.bindings ?? {};
    const canEdit = id => !(this.view.outline?.isLocked(id) ?? false) &&
      !layoutProperties.some(property => bindings[id]?.properties?.[property]?.dynamic);
    const measured = geometry.get(canvas.id);
    const childBounds = Object.fromEntries(canvas.children.map(id => {
      const child = geometry.get(id);
      return [id, child ? {Width: child.width, Height: child.height} : {}];
    }));
    convertCanvasToGrid(this.view.document, {id: canvas.id, canEdit,
      readOnly: !!(this.view.readOnly || this.view.sourceSync?.session?.analysis?.readOnly),
      bounds: measured ? {Width: measured.width, Height: measured.height} : undefined, childBounds});
  }

  parents(root, node) {
    const section = this.section(root, 'Parent and order');
    const select = root.ownerDocument.createElement('select');
    select.setAttribute('aria-label', 'Layout parent');
    for (const parent of this.view.document.value.nodes) {
      if (!childSlot(parent.type)) continue;
      const option = root.ownerDocument.createElement('option');
      option.value = parent.id;
      option.textContent = parent.properties.Name || parent.id;
      select.append(option);
    }
    select.value = this.view.document.parent(node.id)?.id ?? '';
    section.append(select, button(root.ownerDocument, 'Reparent',
      () => this.view.safe(() => this.view.document.move(node.id, select.value)), node.id !== this.view.document.value.root));
    for (const [direction, label] of [['back', 'Send to back'], ['backward', 'Send backward'], ['forward', 'Bring forward'], ['front', 'Bring to front']]) {
      section.append(button(root.ownerDocument, label, () => this.view.safe(() => this.controller.command(`order:${direction}`)),
        node.id !== this.view.document.value.root));
    }
  }

  tracks(root, grid, axis) {
    const section = this.section(root, `Grid ${axis}`);
    const tracks = grid[axis]?.length ? grid[axis] : [{Value: 1, GridUnitType: 2}];
    const edit = options => this.view.safe(() => editGridTracks(this.view.document, {id: grid.id, axis, ...options}));
    tracks.forEach((value, index) => {
      const row = root.ownerDocument.createElement('div');
      row.className = 'design-layout-actions';
      row.dataset.trackIndex = String(index);
      const input = root.ownerDocument.createElement('input');
      input.value = formatTrack(value);
      input.style.width = '66px';
      input.setAttribute('aria-label', `${axis} ${index + 1} sizing`);
      input.onchange = () => edit({action: 'size', index, value: input.value});
      const kind = root.ownerDocument.createElement('select');
      kind.setAttribute('aria-label', `${axis} ${index + 1} unit`);
      for (const [unit, label] of [['0', 'Auto'], ['1', 'Pixel'], ['2', 'Star']]) {
        const option = root.ownerDocument.createElement('option');
        option.value = unit;
        option.textContent = label;
        kind.append(option);
      }
      kind.value = String(value.GridUnitType);
      kind.onchange = () => edit({action: 'size', index,
        value: kind.value === '0' ? 'Auto' : kind.value === '2' ? `${value.GridUnitType === 2 ? value.Value : 1}*` : value.Value});
      row.append(input, kind, button(root.ownerDocument, '+', () => edit({action: 'insert', index})),
        button(root.ownerDocument, '−', () => edit({action: 'remove', index}), tracks.length > 1),
        button(root.ownerDocument, 'Split', () => edit({action: 'split', index}), value.GridUnitType !== 0),
        button(root.ownerDocument, '↑', () => edit({action: 'reorder', index, destination: index - 1}), index > 0),
        button(root.ownerDocument, '↓', () => edit({action: 'reorder', index, destination: index + 1}), index < tracks.length - 1));
      section.append(row);
    });
    section.append(button(root.ownerDocument, `Add ${axis === 'rows' ? 'row' : 'column'}`,
      () => edit({action: 'insert', index: tracks.length}), tracks.length < 64));
  }

  guides(root) {
    const section = this.section(root, 'Grid and guides');
    const settings = guideSettings(this.view.document.value);
    this.input(section, 'Grid size', settings.gridSize,
      gridSize => updateGuideSettings(this.view.document, {gridSize}), {min: .25, max: 1024});
    for (const [key, label] of [['gridVisible', 'Show grid'], ['snapGrid', 'Snap to grid'],
      ['snapGuides', 'Snap to guides'], ['snapSiblings', 'Smart guides']]) {
      const row = root.ownerDocument.createElement('label');
      const checkbox = root.ownerDocument.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = settings[key];
      checkbox.onchange = () => updateGuideSettings(this.view.document, {[key]: checkbox.checked});
      row.append(checkbox, root.ownerDocument.createTextNode(label));
      section.append(row);
    }
  }

  responsive(root) {
    const section = this.section(root, 'Adaptive breakpoints and visual states');
    const states = validateResponsiveDesign(this.view.document.value).states;
    for (const state of states) {
      const row = root.ownerDocument.createElement('div');
      row.className = 'design-layout-actions';
      row.append(button(root.ownerDocument, `${state.id} · ≥ ${state.minWidth}px`, () => {
        this.activeState = state.id;
        this.controller.setPreview({state: state.id});
      }), button(root.ownerDocument, 'Remove', () => this.view.safe(() => {
        this.controller.preview.environment.update({state: null});
        if (this.activeState === state.id) this.activeState = null;
        removeResponsiveState(this.view.document, state.id);
      })));
      section.append(row);
    }
    section.append(button(root.ownerDocument, 'Add breakpoint', () => {
      let suffix = 1;
      while (states.some(state => state.id === `State${suffix}`)) suffix++;
      this.view.safe(() => setResponsiveState(this.view.document, {id: `State${suffix}`,
        minWidth: this.controller.preview.value.width ?? this.view.document.value.width, maxWidth: null, overrides: {}}));
    }), button(root.ownerDocument, 'Automatic preview', () => {
      this.activeState = null;
      this.controller.setPreview({state: null});
    }));
    const current = states.find(state => state.id === this.activeState);
    if (!current) return;
    this.input(section, 'Minimum width', current.minWidth,
      minWidth => setResponsiveState(this.view.document, {...current, minWidth}), {min: 0});
    this.input(section, 'Maximum width (empty means none)', current.maxWidth,
      maxWidth => setResponsiveState(this.view.document, {...current, maxWidth: maxWidth === '' ? null : Number(maxWidth)}), {type: 'text'});
    const node = this.view.document.node();
    const property = root.ownerDocument.createElement('select');
    property.setAttribute('aria-label', 'State override property');
    for (const [key, schema] of Object.entries(propertySchema(node.type))) {
      if (schema.readOnly || schema.isStatic || key === 'Name') continue;
      const option = root.ownerDocument.createElement('option');
      option.textContent = key;
      property.append(option);
    }
    const value = root.ownerDocument.createElement('input');
    value.setAttribute('aria-label', 'State override value');
    section.append(property, value, button(root.ownerDocument, 'Set override', () => this.view.safe(() => {
      const key = property.value;
      const schema = propertySchema(node.type)[key];
      if (schema.type === 'bool' && !['true', 'false'].includes(value.value)) throw new Error('Boolean overrides require true or false.');
      const parsed = schema.type === 'bool' ? value.value === 'true' : value.value;
      const overrides = structuredClone(current.overrides);
      overrides[node.id] ??= {};
      overrides[node.id][key] = normalizeProperty(node.type, key, parsed);
      setResponsiveState(this.view.document, {...current, overrides});
    })));
  }

  drawRails() {
    const view = this.view;
    view.overlay.querySelector('[data-grid-rails]')?.remove();
    if (view.mode !== 'layout' || view.preview) return;
    const selected = view.document.node();
    const grid = selected?.type.endsWith('.Grid') ? selected : view.document.parent(selected?.id);
    if (!grid?.type.endsWith('.Grid')) return;
    const entry = this.controller.geometry.get(grid.id);
    if (!entry) return;
    const group = view.overlay.ownerDocument.createElement('div');
    group.dataset.gridRails = '';
    Object.assign(group.style, {position: 'absolute', inset: '0', transformOrigin: '0 0',
      transform: `matrix(${entry.stageMatrix.join(',')})`});
    for (const axis of ['rows', 'columns']) {
      const values = axis === 'rows' ? entry.style.gridTemplateRows : entry.style.gridTemplateColumns;
      const sizes = values.split(' ').map(Number.parseFloat).filter(Number.isFinite);
      const gap = Number.parseFloat(axis === 'rows' ? entry.style.rowGap : entry.style.columnGap) || 0;
      let offset = 0;
      for (let index = 0; index < sizes.length - 1; index++) {
        offset += sizes[index] + gap;
        const line = button(group.ownerDocument, '', () => {});
        line.className = `design-grid-track ${axis}`;
        line.setAttribute('aria-label', `Resize ${axis} ${index + 1}`);
        Object.assign(line.style, axis === 'rows' ? {left: '0', top: `${offset}px`, width: `${entry.width}px`}
          : {left: `${offset}px`, top: '0', height: `${entry.height}px`});
        line.onpointerdown = event => this.resizeTrack(event, {line, grid, axis, index, sizes});
        group.append(line);
      }
    }
    view.overlay.append(group);
  }

  resizeTrack(event, {line, grid, axis, index, sizes}) {
    event.preventDefault();
    event.stopPropagation();
    const start = this.controller.geometry.localPoint(grid.id, {x: event.clientX, y: event.clientY});
    const revision = this.view.document.revision;
    let delta = 0;
    this.controller.trackPointer(event, pointer => {
      const point = this.controller.geometry.localPoint(grid.id, {x: pointer.clientX, y: pointer.clientY});
      delta = axis === 'rows' ? point.y - start.y : point.x - start.x;
      if (!pointer.altKey) delta = Math.round(delta / this.view.snap) * this.view.snap;
      delta = Math.max(-sizes[index], Math.min(sizes[index + 1], delta));
      line.style.transform = axis === 'rows' ? `translateY(${delta}px)` : `translateX(${delta}px)`;
    }, () => {
      if (delta) resizeGridTracks(this.view.document, {id: grid.id, axis, index, sizes, delta, expectedRevision: revision});
      this.drawRails();
    }, () => this.drawRails());
  }
}
