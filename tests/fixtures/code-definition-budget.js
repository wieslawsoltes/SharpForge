// Browser automation only. Keep the actual Studio editor, scheduler, worker and tool controller intact.
void (globalThis.codeDefinitionBudget = {
  frame() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cancelAnimationFrame(frame);
        reject(new Error('Code Definition frame opportunity timed out'));
      }, 2000);
      const frame = requestAnimationFrame(timestamp => {
        clearTimeout(timeout);
        resolve(timestamp);
      });
    });
  },

  state() {
    const {host} = sharpforge.workbenchShell.mounts.get('code-definition');
    const source = host.querySelector('.wb-definition-editor');
    const rect = source?.getBoundingClientRect();
    return {
      title: host.querySelector('.wb-tool-status')?.textContent ?? '',
      text: source?.value ?? '',
      selection: source?.value.slice(source.selectionStart, source.selectionEnd) ?? '',
      readOnly: source?.readOnly === true,
      visible: !!rect?.width && !!rect?.height && getComputedStyle(source).visibility !== 'hidden'
    };
  },

  matches(state, target) {
    if (!state.readOnly || !state.visible) return false;
    if (target.id === 'none') return state.text === '' && state.title.startsWith('No source or referenced metadata definition');
    if (target.kind === 'source') {
      return state.title === target.uri && state.text === target.text && state.selection === target.name;
    }
    return state.title.includes('SharpForge Framework ABI') && state.title.includes('metadata version') &&
      state.text.startsWith('// Read-only registered framework contracts') && state.selection.includes('WriteLine(');
  },

  async waitFor(target, started) {
    do {
      const state = this.state();
      if (this.matches(state, target)) return {state, observedDomMs: performance.now() - started};
      await this.frame();
    } while (performance.now() - started < 2000);
    return {state: this.state(), observedDomMs: null};
  },

  async setup({records, callerUri, neutralOffset}) {
    await sharpforge.loadDiskRecords(records, {name: 'CodeDefinitionBudget'});
    const shell = sharpforge.workbenchShell;
    await shell.navigate({uri: callerUri});
    await shell.activateTool('code-definition');
    if (!shell.isToolVisible('code-definition') || !shell.mounts.has('code-definition')) {
      throw new Error('Actual Code Definition tool did not mount');
    }
    this.editor = shell.options.getEditor();
    if (!this.editor?.model || shell.context().uri !== callerUri) throw new Error('Actual caller editor is unavailable');
    this.callerUri = callerUri;
    this.neutralOffset = neutralOffset;
    this.editor.setSelections([{anchor: neutralOffset, active: neutralOffset}]);
    this.editor.focus();
    const ready = await this.waitFor({id: 'none'}, performance.now());
    if (ready.observedDomMs === null) throw new Error('Code Definition did not clear at neutral source whitespace');
    await this.frame();
    return {uri: callerUri, sourceVersion: this.editor.model.version, projectId: shell.context().projectId,
      readOnly: ready.state.readOnly, visible: ready.state.visible, workspaceRecords: shell.documents.list().length};
  },

  async sample({target, phase, index}) {
    if (document.visibilityState !== 'visible') throw new Error('A hidden page cannot qualify UI latency');
    if (this.matches(this.state(), target)) throw new Error('A timing visit must change the displayed definition');
    const focus = document.activeElement;
    if (!this.editor.element.contains(focus)) throw new Error('Source editor must own focus before the caret move');
    const version = this.editor.model.version;
    const focusEvents = [];
    const observeFocus = event => {
      if (event.target !== focus) focusEvents.push({tag: event.target.tagName, className: String(event.target.className)});
    };
    document.addEventListener('focusin', observeFocus, true);
    const started = performance.now();
    try {
      this.editor.setSelections([{anchor: target.offset, active: target.offset}]);
      const observed = await this.waitFor(target, started);
      await this.frame();
      const durationMs = performance.now() - started;
      const state = this.state();
      const context = sharpforge.workbenchShell.context();
      const correct = observed.observedDomMs !== null && this.matches(state, target) && focusEvents.length === 0 &&
        document.activeElement === focus && this.editor.model.version === version &&
        context.uri === this.callerUri && context.offset === target.offset;
      return {case: target.id, phase, index, durationMs, observedDomMs: observed.observedDomMs, correct,
        focusPreserved: document.activeElement === focus && focusEvents.length === 0, focusEvents,
        sourceVersion: version, offset: target.offset, title: state.title, text: state.text, selection: state.selection,
        readOnly: state.readOnly, visible: state.visible};
    } finally {
      document.removeEventListener('focusin', observeFocus, true);
    }
  },

  async boundaries(targets) {
    const cleared = await this.sample({target: {id: 'none', offset: this.neutralOffset}, phase: 'boundary', index: 0});
    this.editor.setSelections([{anchor: targets[0].offset, active: targets[0].offset}]);
    const latest = await this.sample({target: targets[1], phase: 'boundary', index: 1});
    return {neutralClears: cleared.correct, rapidCaretUsesLatest: latest.correct, observations: [cleared, latest]};
  }
});
