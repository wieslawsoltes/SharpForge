import {
  DesignerAnnouncements, checkDesignAccessibility, designerKeyboardIntent,
  designSourceDiagnostic, designSourceDiagnostics
} from '../../packages/designer/src/index.js';
import {designerButton} from './designer-command-buttons.js';

const handleNames = {n: 'top', ne: 'top right', e: 'right', se: 'bottom right', s: 'bottom', sw: 'bottom left', w: 'left', nw: 'top left'};

/** Keyboard surface interaction, ordered screen-reader output and navigable design diagnostics. */
export class DesignerAccessibility {
  constructor(view) {
    this.view = view;
    this.region = null;
    this.findings = [];
    this.sourceDiagnostics = [];
    this.checkEnabled = false;
    this.disposed = false;
    this.lastSelection = '';
    this.lastRevision = -1;
  }

  install() {
    if (this.disposed || this.view.disposed || this.view.session?.disposed) return false;
    if (this.region) return true;
    // Source synchronization can report during construction or cleanup, before a surface has mounted.
    if (!this.view.scroller || !this.view.chrome?.commandBar) return false;
    const panel = this.view.panel('designer');
    if (!panel) return false;
    this.region = panel.ownerDocument.createElement('div');
    this.region.className = 'design-visually-hidden';
    this.region.setAttribute('aria-live', 'polite');
    this.region.setAttribute('aria-atomic', 'true');
    this.region.setAttribute('role', 'status');
    panel.append(this.region);
    this.announcements = new DesignerAnnouncements({announce: message => {
      this.region.replaceChildren(this.region.ownerDocument.createTextNode(message));
    }});
    this.view.scroller.setAttribute('role', 'group');
    this.view.scroller.setAttribute('aria-label', 'WinUI design surface');
    this.view.scroller.setAttribute('aria-description',
      'Tab selects controls. Enter selects a child. Escape selects its parent. Arrows move. Control with arrows resizes. Insert opens the toolbox.');
    const holder = panel.ownerDocument.createElement('div');
    holder.innerHTML = designerButton('check', 'Check accessibility', 'accessibility');
    const button = holder.firstElementChild;
    button.onclick = () => this.view.safe(() => this.check());
    this.view.chrome.commandBar.add(button);
    return true;
  }

  announce(message) {
    if (this.install()) this.announcements.push(message);
  }

  update(event = {}) {
    if (!this.install()) return;
    const selection = this.view.document.selection.join(',');
    if (selection !== this.lastSelection) {
      this.lastSelection = selection;
      const descriptions = this.view.document.selection.map(id => {
        const node = this.view.document.node(id);
        return `${node.properties.Name ?? id}, ${(node.projectType ?? node.type).split('.').at(-1)}`;
      });
      this.announce('Selected ' + descriptions.join('; '));
    }
    if (event.kind !== 'selection' && this.lastRevision !== this.view.document.revision) {
      this.lastRevision = this.view.document.revision;
      const node = this.view.document.node();
      const properties = node?.properties;
      if (properties && [properties.Width, properties.Height].every(Number.isFinite)) {
        this.announce(`Geometry ${properties.Left ?? 0}, ${properties.Top ?? 0}; ${properties.Width} by ${properties.Height}`);
      }
      if (this.checkEnabled) this.check({show: false});
    }
    this.adorners();
  }

  adorners() {
    for (const handle of this.view.overlay?.querySelectorAll('[data-resize]') ?? []) {
      handle.setAttribute('role', 'button');
      handle.setAttribute('aria-label', 'Resize selected control from ' + (handleNames[handle.dataset.resize] ?? handle.dataset.resize));
      handle.setAttribute('aria-description', 'Use Control and arrow keys to resize the selected control from the keyboard.');
    }
    for (const row of this.view.panel('designer-properties')?.querySelectorAll('[data-property]') ?? []) {
      if (!row.getAttribute('aria-label')) row.setAttribute('aria-label', row.dataset.property);
    }
  }

  syncChanged(state) {
    if (this.disposed) return;
    this.announce('Synchronization: ' + state.state.replaceAll('-', ' ') + '. ' + state.message);
    const analysis = this.view.sourceSync.session?.analysis;
    this.sourceDiagnostics = [...(state.diagnostics ?? analysis?.diagnostics ?? (analysis ? designSourceDiagnostics(analysis) : []))];
    if (state.error) this.sourceDiagnostics.push(designSourceDiagnostic(state.error, {uri: state.uri}));
    this.publish();
  }

  reportError(error) {
    const uri = this.view.sourceSync?.snapshot?.().uri ?? this.view.path;
    const diagnostics = error.diagnostics ?? (error.diagnostic ? [error.diagnostic] : null);
    this.sourceDiagnostics = diagnostics ? diagnostics.map(diagnostic => {
      const binding = this.view.sourceSync?.session?.analysis?.bindings?.[diagnostic.nodeId];
      const location = diagnostic.span ?? binding?.declaration ?? {start: 0, end: 0};
      const start = diagnostic.start ?? location.start ?? 0;
      const length = diagnostic.length ?? location.length ?? (location.end === undefined ? 0 : location.end - start);
      const span = {start, end: start + length};
      return {...diagnostic, uri: diagnostic.uri ?? uri, source: diagnostic.source ?? 'Designer', span,
        start, length};
    }) : [designSourceDiagnostic(error, {uri})];
    this.publish();
    this.announce(error.message ?? String(error));
  }

  publish() {
    this.view.publishDesignerDiagnostics?.([...this.sourceDiagnostics, ...this.findings]);
  }

  check({show = true} = {}) {
    this.checkEnabled = true;
    const geometry = new Map();
    for (const [id, element] of this.view.host.elements) {
      if (!this.view.document.node(id)) continue;
      const bounds = element.getBoundingClientRect();
      geometry.set(id, {width: bounds.width / this.view.zoom, height: bounds.height / this.view.zoom});
    }
    this.findings = checkDesignAccessibility(this.view.document.value, {
      geometry, isVisible: id => this.view.outline?.isVisible(id) !== false
    });
    const uri = this.view.sourceSync.snapshot().uri ?? this.view.path;
    const bindings = this.view.sourceSync.session?.analysis.bindings;
    for (const finding of this.findings) {
      finding.uri = uri;
      finding.span = bindings?.[finding.nodeId]?.declaration ?? {start: 0, end: 0};
      finding.start = finding.span.start;
      finding.length = finding.span.end - finding.span.start;
    }
    this.publish();
    if (show || this.view.panel('designer').querySelector('.design-accessibility-results')) this.renderFindings();
    if (show) {
      this.announce(this.findings.length ? `${this.findings.length} accessibility findings` : 'No accessibility findings for checked properties');
    }
    return this.findings;
  }

  renderFindings() {
    const panel = this.view.panel('designer');
    let container = panel.querySelector('.design-accessibility-results');
    if (!container) {
      container = panel.ownerDocument.createElement('section');
      container.className = 'design-accessibility-results';
      container.setAttribute('aria-label', 'Design accessibility findings');
      panel.append(container);
    }
    container.replaceChildren();
    const heading = container.ownerDocument.createElement('strong');
    heading.textContent = this.findings.length ? `${this.findings.length} accessibility findings` : 'No findings for checked properties';
    container.append(heading);
    for (const finding of this.findings) {
      const button = container.ownerDocument.createElement('button');
      button.type = 'button';
      button.textContent = `${finding.nodeId}: ${finding.message}`;
      button.title = finding.fixHint;
      button.onclick = () => {
        this.view.document.select(finding.nodeId);
        this.view.docking.activate('designer-properties');
      };
      container.append(button);
    }
  }

  handleKey(event) {
    if (this.view.preview || event.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return false;
    // Surface gestures own geometry modifiers and coalesce repeated keys into one undo entry.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && !event.altKey) return false;
    const intent = designerKeyboardIntent(this.view.document, event, {isVisible: id => this.view.outline?.isVisible(id) !== false});
    if (!intent) return false;
    event.preventDefault();
    event.stopPropagation();
    if (intent.kind === 'reorder' && this.view.surface?.orderKey) {
      this.view.safe(() => this.view.surface.orderKey(event, intent.delta));
      return true;
    }
    this.view.surface?.finishKeyboard?.();
    this.view.safe(() => this.applyIntent(intent));
    return true;
  }

  applyIntent(intent) {
    const document = this.view.document;
    if (intent.kind === 'select') return document.select(intent.id);
    if (intent.kind === 'insert') return this.view.toolbox.openInsertion();
    this.view.outline?.assertEditable();
    if (intent.kind === 'reorder') return this.view.reorder(intent.delta);
    const geometry = {};
    for (const id of document.selection) {
      const node = document.node(id);
      const parent = document.parent(id);
      if (!parent) throw new Error('Select a child control before moving or resizing');
      const bounds = this.view.host.elements.get(id)?.getBoundingClientRect();
      const measuredWidth = Number.isFinite(bounds?.width) ? bounds.width / this.view.zoom : 1;
      const measuredHeight = Number.isFinite(bounds?.height) ? bounds.height / this.view.zoom : 1;
      if (intent.kind === 'resize') {
        geometry[id] = {
          Width: Math.max(1, (node.properties.Width ?? measuredWidth) + intent.dx),
          Height: Math.max(1, (node.properties.Height ?? measuredHeight) + intent.dy)
        };
      } else if (parent.type.endsWith('.Canvas')) {
        geometry[id] = {Left: (node.properties.Left ?? 0) + intent.dx, Top: (node.properties.Top ?? 0) + intent.dy};
      } else if (parent.type.endsWith('.Grid')) {
        geometry[id] = {
          Column: Math.max(0, Math.min((parent.columns?.length ?? 1) - 1, (node.properties.Column ?? 0) + intent.dx)),
          Row: Math.max(0, Math.min((parent.rows?.length ?? 1) - 1, (node.properties.Row ?? 0) + intent.dy))
        };
      } else return this.view.reorder(intent.dx || intent.dy);
    }
    return document.geometry(geometry);
  }

  dispose() {
    this.disposed = true;
    this.announcements?.dispose();
    this.region?.remove();
    this.view.publishDesignerDiagnostics?.([]);
  }
}
