import { storage, storageKeys } from '../settings/storage.js';
import { searchTemplates, templateAvailability } from '../../../packages/templates/src/index.js';
import { workspaceCandidates } from '../../../packages/project-system/src/index.js';
import { WizardModel } from './model.js';
import { wizardView, escapeWizardHtml as escape } from './view.js';
import { chooseWizardDirectory, commitWizardDirectory } from './destination.js';

/** UI state is separate from file planning and the explicit destination transaction. */
export class ProjectWizard {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.recent = [];
    try {
      const stored = JSON.parse(storage.getItem(storageKeys.recent));
      const ids = new Set(searchTemplates({ kind: 'all' }).map(template => template.id));
      if (Array.isArray(stored)) this.recent = stored.filter(id => ids.has(id)).slice(0, 8);
    } catch (error) { this.storageWarning = error.message; }
  }
  remember(id) {
    this.recent = [id, ...this.recent.filter(value => value !== id)].slice(0, 8);
    try { storage.setItem(storageKeys.recent, JSON.stringify(this.recent)); }
    catch (error) { this.storageWarning = error.message; }
  }
  openProject({ add = false, node = null } = {}) { return this.open({ kind: 'project', add, node }); }
  openItem(node = null) { return this.open({ kind: 'item', add: true, node }); }
  async open(options) {
    if (this.active) throw new Error('Complete or cancel the active wizard first');
    const context = this.host.context();
    if (context.readOnly) throw new Error('Stop debugging before creating files');
    this.active = true;
    this.busy = false;
    this.model = new WizardModel(context, options);
    this.cancellation = new AbortController();
    const result = new Promise(resolve => { this.resolve = resolve; });
    try { this.render(); return await result; }
    finally {
      this.cancellation.abort();
      const modal = document.querySelector('#modal');
      modal?.classList.remove('wizard-modal');
      if (modal) modal.onkeydown = null;
      this.active = false;
    }
  }
  finish(value) {
    if (!this.active) return;
    this.active = false;
    this.host.detachModalClose();
    this.host.closeModal();
    this.resolve(value);
  }
  $(selector) { return document.querySelector('#modal')?.querySelector(selector); }
  render() {
    const view = wizardView(this.model);
    this.host.detachModalClose();
    this.host.showModal(view.title, view.body, { wide: true, footer: view.footer, onClose: () => this.finish(null) });
    const modal = document.querySelector('#modal');
    modal.classList.add('wizard-modal');
    this.$('#wizard-cancel').onclick = () => this.finish(null);
    this.$('#wizard-back')?.addEventListener('click', () => { this.model.step = 0; this.render(); });
    this.$('#wizard-next').onclick = () => this.next();
    if (this.model.step === 0) this.bindCatalog();
    else this.bindConfiguration();
    modal.onkeydown = event => this.keyboard(event);
  }
  describe() {
    const template = this.model.template;
    const target = this.$('#wizard-description');
    if (!target || !template) return;
    const availability = templateAvailability(template, { native: !!this.model.context.native, platform: this.model.context.platform });
    target.innerHTML = `<span class="wizard-large-icon">${escape(template.icon ?? (template.winui ? '▣' : 'C#'))}</span>` +
      `<h3>${escape(template.name)}</h3><p>${escape(template.description)}</p><div class="wizard-tags">` +
      `<span>${escape(template.language)}</span><span>${escape(template.category)}</span><span>${escape(template.platform)}</span></div>` +
      (availability.available ? '' : `<p class="wizard-boundary">${escape(availability.reason)}</p>`) +
      (template.prerequisites?.length ? `<p>Prerequisites: ${escape(template.prerequisites.join('; '))}</p>` : '') +
      '<p>Inspect every generated file before creation.</p>';
  }
  drawList() {
    const filtered = this.model.filtered();
    if (!filtered.some(template => template.id === this.model.selected)) this.model.selected = filtered[0]?.id ?? this.model.selected;
    const list = this.$('#wizard-template-list');
    list.innerHTML = filtered.map(template => `<button type="button" class="wizard-template ${template.id === this.model.selected ? 'selected' : ''}" ` +
      `role="option" aria-selected="${template.id === this.model.selected}" data-template="${escape(template.id)}">` +
      `<span class="wizard-template-icon">${escape(template.icon ?? (template.winui ? '▣' : 'C#'))}</span><span><b>${escape(template.name)}</b>` +
      `<small>${escape(template.description)}</small><span class="wizard-template-tags">${escape(template.language)} · ${escape(template.category)}` +
      `${template.nativeOnly ? ' · Native prerequisite' : ''}${this.recent.includes(template.id) ? ' · Recent' : ''}</span></span></button>`).join('') ||
      '<p class="wizard-empty">No templates match these filters.</p>';
    this.$('#wizard-next').disabled = !filtered.length;
    for (const button of list.querySelectorAll('[data-template]')) {
      button.onclick = () => { this.model.selected = button.dataset.template; this.drawList(); };
      button.ondblclick = () => this.next();
    }
    this.describe();
  }
  bindCatalog() {
    const filters = [['wizard-search', 'query', 'input'], ['wizard-category', 'category', 'change'], ['wizard-language', 'language', 'change']];
    for (const [id, key, event] of filters) {
      this.$('#' + id).addEventListener(event, change => { this.model[key] = change.target.value; this.drawList(); });
    }
    this.$('#wizard-template-list').onkeydown = event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Enter') { this.next(); return; }
      const filtered = this.model.filtered();
      let index = filtered.findIndex(template => template.id === this.model.selected);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 :
        Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      if (filtered[index]) this.model.selected = filtered[index].id;
      this.drawList();
      this.$('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    this.drawList();
  }
  bindConfiguration() {
    const fields = [
      ['wizard-project-name', 'projectName'], ['wizard-solution-name', 'solutionName'], ['wizard-namespace', 'namespace'],
      ['wizard-location', 'location'], ['wizard-framework', 'framework'], ['wizard-solution-mode', 'solutionMode'],
      ['wizard-item-name', 'name'], ['wizard-destination', 'destination'], ['wizard-nullable', 'nullable'],
      ['wizard-solution-format', 'solutionFormat']
    ];
    for (const [id, key] of fields) {
      const field = this.$('#' + id);
      field?.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', event => {
        this.model.set(key, event.target.value);
        if (key === 'projectName') {
          this.$('#wizard-solution-name').value = this.model.values.solutionName;
          this.$('#wizard-namespace').value = this.model.values.namespace;
        }
        if (key === 'solutionMode') this.$('#wizard-solution-name').disabled = this.model.values.solutionMode === 'existing';
        if (key === 'destination') {
          this.$('#wizard-browse').hidden = this.model.values.destination !== 'directory';
          this.$('#wizard-destination-path').textContent = this.model.directoryHandle?.name ??
            (this.model.values.destination === 'directory' ? 'No folder selected' : this.model.values.destination + ' workspace');
        }
        this.updatePreview();
      });
    }
    for (const [id, key] of [['wizard-same-directory', 'sameDirectory'], ['wizard-checked', 'checked'],
      ['wizard-implicit-usings', 'implicitUsings'], ['wizard-program-main', 'useProgramMain']]) {
      this.$('#' + id)?.addEventListener('change', event => { this.model.set(key, event.target.checked); this.updatePreview(); });
    }
    this.$('#wizard-browse')?.addEventListener('click', () => this.browse());
    this.updatePreview();
  }
  async browse() {
    if (this.busy) return;
    try {
      const result = await chooseWizardDirectory({ signal: this.cancellation.signal, picker: this.host.showDirectoryPicker ?? globalThis.showDirectoryPicker });
      if (result.cancelled) this.$('#wizard-destination-status').textContent = 'Folder selection cancelled. No files were created.';
      else {
        this.model.directoryHandle = result.handle;
        this.$('#wizard-destination-path').textContent = result.name;
        this.$('#wizard-destination-status').textContent = 'Folder selected. Conflicts and permissions will be checked before creation.';
      }
      this.updatePreview();
    } catch (error) { this.$('#wizard-errors').textContent = error.message; }
  }
  updatePreview() {
    try {
      this.model.preview = this.model.plan(this.host.context());
      const plan = this.model.preview;
      this.$('#wizard-errors').textContent = '';
      this.$('#wizard-next').disabled = this.model.values.destination === 'directory' && !this.model.directoryHandle;
      this.$('#wizard-warnings').textContent = [...plan.warnings, ...(plan.diagnostics ?? []).map(item => item.message)].join(' ');
      this.$('#wizard-file-count').textContent = plan.records.length + ' new' +
        (plan.modifications.length ? ' · ' + plan.modifications.length + ' updated' : '');
      const files = [...plan.records.map(file => ({ ...file, action: 'Create' })), ...plan.modifications.map(file => ({ ...file, action: 'Update' }))];
      this.$('#wizard-files').innerHTML = files.map((file, index) => `<button type="button" data-preview-file="${index}">` +
        `<span>${file.action}</span>${escape(file.path)}</button>`).join('') +
        plan.folders.map(path => `<div class="wizard-folder">▰ ${escape(path)}/</div>`).join('');
      const show = index => {
        this.$('#wizard-code').textContent = files[index]?.text ?? (files[index]?.bytes ? files[index].bytes.length + ' binary bytes' : '');
      };
      for (const button of this.$('#wizard-files').querySelectorAll('button')) button.onclick = () => show(Number(button.dataset.previewFile));
      show(0);
    } catch (error) {
      this.model.preview = null;
      this.$('#wizard-errors').textContent = error.message;
      this.$('#wizard-next').disabled = true;
      this.$('#wizard-files').innerHTML = '';
      this.$('#wizard-code').textContent = '';
    }
  }
  setBusy(value) {
    this.busy = value;
    this.host.lockModal?.(value);
    for (const id of ['modal-close', 'wizard-next', 'wizard-cancel', 'wizard-back']) if (this.$('#' + id)) this.$('#' + id).disabled = value;
    this.$('#wizard-next').textContent = value ? 'Creating…' : this.model.kind === 'item' ? 'Add' : 'Create';
  }
  async next() {
    if (this.busy) return;
    if (this.model.step === 0) {
      if (this.model.kind === 'item') this.model.values.name = this.model.template.fileName;
      this.model.step = 1;
      this.render();
      return;
    }
    let destination = null;
    try {
      const plan = this.model.plan(this.host.context());
      this.setBusy(true);
      if (this.model.values.destination === 'directory') {
        destination = await commitWizardDirectory(this.model.directoryHandle, plan, {
          signal: this.cancellation.signal, confirmOverwrite: this.host.confirmOverwrite ?? globalThis.confirm
        });
        if (destination.cancelled) { this.setBusy(false); return; }
      }
      await this.host.commitPlan(plan, {
        add: this.model.add || this.model.values.destination === 'native', kind: this.model.kind, context: this.model.context,
        node: this.model.node, destination: this.model.values.destination, ...(destination ?? {})
      });
      this.remember(this.model.selected);
      this.host.lockModal?.(false);
      this.finish(plan);
    } catch (error) {
      this.setBusy(false);
      this.$('#wizard-errors').textContent = (destination?.writeResult || error.writeResult ?
        'Files were saved to the selected folder; opening failed. ' : '') + error.message;
    }
  }
  keyboard(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!this.busy) this.finish(null); }
    if (event.altKey && event.key.toLowerCase() === 's') { this.$('#wizard-search')?.focus(); event.preventDefault(); }
    if (event.key === 'Tab') {
      const controls = [...document.querySelector('#modal').querySelectorAll('button,input,select,textarea,[tabindex="0"]')]
        .filter(control => !control.disabled && control.offsetParent !== null);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
    }
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      if (!this.$('#wizard-next').disabled) this.next();
    }
  }
  async selectImport(records, { name = 'Workspace', folders = [], settings = {}, force = false } = {}) {
    const candidates = workspaceCandidates(records);
    const solutions = candidates.filter(path => /\.(slnx|sln)$/i.test(path));
    if (!force && (settings.entry || solutions.length === 1 || candidates.length <= 1)) return {
      entry: settings.entry ?? solutions[0] ?? candidates[0] ?? null,
      mode: settings.mode ?? (solutions.length ? 'solution' : candidates.length ? 'project' : 'folder'), name
    };
    return this.host.ask('Open project, solution or folder',
      `<p class="wizard-boundary">${records.length} files and ${folders.length} folders will be preserved. Choose the build entry.</p>` +
      '<label class="wizard-import-field">Open as<select id="workspace-entry"><option value="">Folder view</option>' +
      candidates.map(path => `<option value="${escape(path)}" ${path === (settings.entry ?? solutions[0] ?? candidates[0]) ? 'selected' : ''}>` +
        escape(path) + '</option>').join('') + '</select></label><p>Loading files does not execute them.</p>', 'Open', () => {
        const entry = document.querySelector('#workspace-entry').value;
        return { entry: entry || null, mode: entry ? /\.(slnx|sln)$/i.test(entry) ? 'solution' : 'project' : 'folder', name };
      });
  }
}
