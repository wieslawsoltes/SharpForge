// Browser automation only. Time the same OverviewRuler.render used by VirtualEditorView, with actual canvas pixels.
void (globalThis.overviewBudget = {
  expected: [
    {kind: 'error', line: 0, rgba: [239, 113, 132, 255]},
    {kind: 'warning', line: 1371, rgba: [232, 204, 117, 255]},
    {kind: 'breakpoint', line: 2731, rgba: [239, 113, 132, 255]},
    {kind: 'bookmark', line: 4095, rgba: [97, 182, 239, 255]},
    {kind: 'saved', line: 5461, rgba: [101, 174, 113, 255]},
    {kind: 'unsaved', line: 6827, rgba: [232, 204, 117, 255]},
    {kind: 'find', line: 8191, rgba: [223, 174, 72, 255]},
    {kind: 'caret', line: 9999, rgba: [222, 222, 222, 255]}
  ],

  frame(callback = timestamp => timestamp) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cancelAnimationFrame(frame);
        reject(new Error('Overview frame opportunity timed out'));
      }, 2000);
      const frame = requestAnimationFrame(timestamp => {
        clearTimeout(timeout);
        try { resolve(callback(timestamp)); }
        catch (error) { reject(error); }
      });
    });
  },

  async setup() {
    const text = Array.from({length: 10000}, (_, line) =>
      ' '.repeat(line % 5) + '// line ' + String(line).padStart(5, '0') + ' ' + 'x'.repeat(10 + line % 90)).join('\n');
    setupView({text, options: {overviewRuler: true, mapMode: 'narrow'}});
    const editor = globalThis.editor;
    const at = line => editor.model.offsetAt({line, character: 0});
    editor.applyEdits([{start: at(5461), end: at(5461), text: '// saved '}], {source: 'budget-fixture', undoStop: true});
    editor.markSaved();
    editor.applyEdits([{start: at(6827), end: at(6827), text: '// unsaved '}], {source: 'budget-fixture', undoStop: true});
    editor.setDiagnostics([{start: at(0), length: 1, severity: 'error', message: 'Fixture error'},
      {start: at(1371), length: 1, severity: 'warning', message: 'Fixture warning'}]);
    editor.setBreakpoints([{line: 2732, enabled: true}]);
    editor.toggleBookmark(4095);
    editor.setDecorations('budget-find', [{start: at(8191), end: at(8191) + 1, kind: 'find'}]);
    editor.setSelections([{anchor: at(9999), active: at(9999)}]);
    await this.frame();
    await this.frame();
    if (editor.model.lineCount !== 10000 || editor.largeFile.active ||
        editor.changeTracking.stateAt(5461) !== 'saved' || editor.changeTracking.stateAt(6827) !== 'unsaved') {
      throw new Error('Actual 10,000-line editor and tracked-change annotations are not ready');
    }
    this.version = editor.model.version;
    return {lineCount: editor.model.lineCount, sourceCharacters: editor.model.length, sourceVersion: this.version,
      largeFileActive: editor.largeFile.active, annotationKinds: this.expected.map(mark => mark.kind)};
  },

  async mode(mode) {
    if (!['narrow', 'medium', 'wide'].includes(mode)) throw new Error('Unknown overview mode');
    const offset = editor.model.offsetAt({line: 9999, character: 0});
    editor.setSelections([{anchor: offset, active: offset}]);
    editor.setOptions({mapMode: mode, overviewRuler: true});
    await this.frame();
    await this.frame();
  },

  pixels(image, canvas) {
    const marks = this.expected.map(mark => {
      const expectedY = Math.round(mark.line / 9999 * (canvas.height - 1));
      const x = mark.kind === 'caret' ? 0 : canvas.width - 6;
      const offset = (expectedY * canvas.width + x) * 4;
      const rgba = Array.from(image.data.slice(offset, offset + 4));
      return {kind: mark.kind, line: mark.line, expectedY, rgba,
        correct: rgba.every((value, channel) => value === mark.rgba[channel])};
    });
    let mapPixels = 0;
    for (let offset = 3; offset < image.data.length; offset += 4) {
      if (image.data[offset] > 0 && image.data[offset] < 255) mapPixels++;
    }
    return {marks, mapPixels};
  },

  async sample({mode, phase, index}) {
    if (document.visibilityState !== 'visible') throw new Error('A hidden page cannot qualify overview rendering');
    const ruler = editor.view.overview;
    const canvas = ruler.canvas;
    const context = canvas.getContext('2d');
    const measured = await this.frame(frameTimestamp => {
      const started = performance.now();
      ruler.render();
      const renderMs = performance.now() - started;
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const durationMs = performance.now() - started;
      return {renderMs, durationMs, frameTimestamp, image};
    });
    const nextFrameTimestamp = await this.frame();
    const pixels = this.pixels(measured.image, canvas);
    const rect = canvas.getBoundingClientRect();
    const width = {narrow: 40, medium: 70, wide: 110}[mode];
    const correct = editor.options.mapMode === mode && !editor.largeFile.active && !canvas.hidden &&
      canvas.width === width && canvas.height === editor.view.viewport.clientHeight && rect.width === width &&
      rect.height > 0 && getComputedStyle(canvas).display !== 'none' && editor.model.lineCount === 10000 &&
      editor.model.version === this.version && pixels.marks.every(mark => mark.correct) && pixels.mapPixels > 0;
    return {case: mode, phase, index, durationMs: measured.durationMs, renderMs: measured.renderMs,
      followingRafMs: nextFrameTimestamp - measured.frameTimestamp, correct, canvas: {width: canvas.width,
        height: canvas.height, cssWidth: rect.width, cssHeight: rect.height}, ...pixels};
  },

  pointerTarget() {
    const canvas = editor.view.overview.canvas;
    const rect = canvas.getBoundingClientRect();
    const y = rect.top + rect.height * 0.421;
    const line = Math.round((y - rect.top) / rect.height * 9999);
    return {x: rect.left + rect.width / 2, y, line, title: `${line + 1}: ${editor.model.getLine(line).slice(0, 240)}`};
  },

  pointerResult(target) {
    return {previewMatches: editor.view.overview.canvas.title === target.title,
      navigationMatches: editor.model.positionAt(editor.offset).line === target.line,
      expectedLine: target.line, actualLine: editor.model.positionAt(editor.offset).line,
      title: editor.view.overview.canvas.title};
  }
});
