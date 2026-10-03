import {escapeHtml as escape} from '../../packages/editor/src/index.js';
import {DesignerCommandBar} from './designer-command-bar.js';
import {decorateDesignerSync} from './designer-command-buttons.js';

/** Coordinates presentation only; document hosts own modes and split layout. */
export class DesignerChrome {
  constructor(view) {
    this.view = view;
    this.fallbackMode = 'design';
    this.installed = false;
  }

  get mode() {
    return this.view.preview ? 'preview' : this.view.session?.viewState.mode ?? this.fallbackMode;
  }

  install() {
    if (this.installed) return;
    this.installed = true;
    const panel = this.view.panel('designer');
    const document = panel.ownerDocument;
    this.sync = document.createElement('div');
    this.sync.className = 'design-sync-bar';
    this.crumbs = document.createElement('nav');
    this.crumbs.className = 'design-breadcrumbs';
    this.crumbs.setAttribute('aria-label', 'Selected control ancestry');
    panel.insertBefore(this.crumbs, this.view.scroller);
    this.modeTabs = this.view.documentHost ? null : this.createModes(document);
    this.commandBar = new DesignerCommandBar(this.view, {modes: this.modeTabs, sync: this.sync});
    const host = this.view.documentHost;
    if (host?.commandSlot) {
      host.commandSlot.append(this.commandBar.element);
      if (host.modeControls) {
        host.modeControls.classList.add('design-mode-tabs');
        for (const button of host.modeControls.querySelectorAll('[data-document-view]')) {
          button.dataset.designView = button.dataset.documentView;
          if (button.dataset.documentView === 'code') button.textContent = 'C#';
        }
        this.commandBar.primary.prepend(host.modeControls);
      }
      if (host.layoutControls) this.commandBar.add(host.layoutControls);
      host.modeBar.classList.add('design-mode-bar');
      host.modeBar.setAttribute('role', 'presentation');
      host.modeBar.removeAttribute('aria-label');
    }
    this.scroll = () => this.rulers();
    this.view.scroller.addEventListener('scroll', this.scroll, {passive: true});
    this.renderSync();
    this.renderSelection();
    this.rulers();
  }

  createModes(document) {
    const tabs = document.createElement('div');
    tabs.className = 'design-mode-tabs';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Document view');
    for (const [mode, label] of [['design', 'Design'], ['split', 'Split'], ['code', 'C#'], ['preview', 'Preview']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.designView = mode;
      button.textContent = label;
      button.setAttribute('aria-label', label + ' view');
      button.onclick = () => this.view.safe(() => this.setMode(mode));
      tabs.append(button);
    }
    return tabs;
  }

  setMode(mode) {
    if (!['design', 'split', 'code', 'preview'].includes(mode)) throw new RangeError('Unknown designer view');
    this.fallbackMode = mode;
    this.view.preview = mode === 'preview';
    const host = this.view.documentHost;
    if (host) host.setMode(mode === 'preview' ? 'design' : mode);
    else if (mode === 'code') {
      const uri = this.view.sourceSync.session?.analysis.uri;
      if (uri) this.view.openSource(uri);
      else this.view.docking.activate('designer-source');
    }
    this.view.resizeArtboard();
    this.renderSync();
    return mode;
  }

  setDensity(density) {
    if (!['default', 'compact'].includes(density)) throw new RangeError('Unknown designer density');
    this.view.panel('designer').dataset.designDensity = density;
    if (this.commandBar) this.commandBar.element.dataset.designDensity = density;
    this.commandBar?.layout();
  }

  renderSync() {
    if (!this.installed) return;
    const sync = this.view.sourceSync;
    this.sync.innerHTML = sync.renderControls();
    sync.bindControls(this.sync);
    decorateDesignerSync(this.sync);
    const state = sync.snapshot();
    this.sync.dataset.state = state.state;
    this.sync.title = state.message;
    this.commandBar.state.textContent = state.uri ? state.state.replaceAll('-', ' ') : 'Unlinked';
    this.commandBar.state.title = state.message;
    this.commandBar.state.dataset.state = state.state;
    for (const button of this.modeTabs?.querySelectorAll('[data-design-view]') ?? []) {
      button.setAttribute('aria-pressed', String(button.dataset.designView === this.mode));
    }
    this.view.accessibility?.syncChanged(state);
    this.commandBar.layout();
  }

  renderSelection(context) {
    if (!this.installed) return;
    const view = this.view;
    const selected = view.document.node();
    if (!selected) return;
    const nodes = [];
    const visited = new Set();
    for (let node = selected; node && !visited.has(node.id); node = view.document.parent(node.id)) {
      visited.add(node.id);
      nodes.unshift(node);
    }
    const custom = context ?? view.resources?.breadcrumbContext?.();
    const crumbs = custom?.crumbs ?? nodes.map(node => ({
      id: node.id, label: node.properties.Name || node.id, type: node.projectType ?? node.type
    }));
    this.crumbs.replaceChildren();
    const document = this.crumbs.ownerDocument;
    const label = document.createElement('span');
    label.className = 'design-context-label';
    label.textContent = custom?.label ?? (view.live ? 'Live app' : 'Document');
    this.crumbs.append(label);
    for (const crumb of crumbs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.crumb = crumb.id;
      button.title = crumb.type ?? crumb.label;
      button.textContent = crumb.label;
      button.onclick = () => crumb.select ? crumb.select() : view.document.select(crumb.id);
      this.crumbs.append(button);
    }
    const count = document.createElement('span');
    count.className = 'design-selection-count';
    count.textContent = (custom?.count ?? view.document.selection.length) + ' selected';
    this.crumbs.append(count);
    const source = view.sourceSync.session?.analysis;
    const binding = source?.bindings[selected.id];
    if (binding) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Go to C#';
      button.dataset.designGotoSource = '';
      button.onclick = () => view.openSource(source.uri, binding.declaration?.start ?? binding.statement?.start ?? source.method.start);
      this.crumbs.append(button);
    }
  }

  rulers() {
    if (!this.installed) return;
    const view = this.view;
    const ruler = view.panel('designer').querySelector('.design-ruler.horizontal');
    if (!ruler) return;
    const step = view.zoom < .5 ? 200 : 100;
    const offset = 38 - view.scroller.scrollLeft;
    const width = view.surface?.preview?.value.width ?? view.document.value.width;
    ruler.innerHTML = Array.from({length: Math.ceil(width / step) + 1}, (_, index) =>
      `<span style="left:${offset + index * step * view.zoom}px">${index * step}</span>`).join('');
    ruler.style.backgroundSize = step / 10 * view.zoom + 'px 100%';
  }

  refreshSource() {
    if (this.view.state.panel === 'designer-source') this.view.renderSource();
    this.renderSync();
  }

  source(element) {
    const sync = this.view.sourceSync;
    const state = sync.snapshot();
    const panel = element.ownerDocument.createElement('section');
    panel.className = 'design-source-link';
    panel.setAttribute('aria-label', 'Source synchronization');
    panel.innerHTML = `<div class="panel-tools">${sync.renderControls()}</div><p>${escape(state.message)}</p>`;
    if (state.warnings?.length) {
      const details = element.ownerDocument.createElement('details');
      details.innerHTML = `<summary>${state.warnings.length} protected expressions</summary>` +
        state.warnings.map(warning => `<p>${escape(warning.node ?? '')} ${escape(warning.property ?? '')}: ` +
          `${escape(warning.message)}</p>`).join('');
      panel.append(details);
    }
    element.prepend(panel);
    sync.bindControls(panel);
    decorateDesignerSync(panel);
  }

  dispose() {
    this.view.scroller?.removeEventListener('scroll', this.scroll);
    this.commandBar?.dispose();
    this.crumbs?.remove();
    this.installed = false;
  }
}
