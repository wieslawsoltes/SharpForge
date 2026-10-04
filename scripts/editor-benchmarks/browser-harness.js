import { CodeEditor, EditorModel } from '@sharpforge/editor';
import { createEditorFixture, pasteFixture } from './fixtures.js';

let editor = null;
let model = null;
let fixture = null;
let measurement = null;
let lastPaintMs = null;
const container = document.querySelector('#editor');
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function recordEvent(event) {
  if (!measurement || !['beforeinput', 'input', 'keydown', 'scroll', 'paste'].includes(event.type)) return;
  if (event.type === 'keydown' && ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
  if (measurement.started === null) measurement.started = performance.now();
}
for (const type of ['beforeinput', 'input', 'keydown', 'scroll', 'paste']) container.addEventListener(type, recordEvent, true);

async function waitForSearch() {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const status = container.querySelector('.sf-find-count[role="status"]');
    const popup = container.querySelector('.sf-find');
    const message = status?.textContent ?? '';
    const complete = !popup?.dataset.searchState || popup.dataset.searchState === 'complete';
    if (complete && /(?:^1 matches$|^1 of 1 matches$)/.test(message) && editor.offset === fixture.markerOffset) return;
    if (popup?.dataset.searchState === 'error' || /^(?:SF[A-Z0-9]+|Search):/.test(message)) {
      throw new Error(`Browser find failed: ${message}`);
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  throw new Error('Browser find did not settle at the expected result within 30 seconds');
}

const api = {
  async create(sizeBytes) {
    editor?.dispose();
    model?.dispose();
    fixture = createEditorFixture(sizeBytes);
    const start = performance.now();
    model = new EditorModel(fixture.text, { uri: fixture.uri, undo: { maxOperations: 1000, coalesceMs: 0 } });
    editor = new CodeEditor(container, { model, onEdits() {}, request: async () => null });
    await nextPaint();
    return { createToPaintMs: performance.now() - start, length: model.length, metrics: editor.highlightMetrics ?? null };
  },
  async prepare(operation) {
    editor.focus();
    editor.setSelections([{ anchor: 0, active: 0 }]);
    if (operation === 'undo') {
      editor.applyEdits([{ start: 0, end: 0, text: pasteFixture() }], { command: 'benchmark', undoStop: true });
    }
    if (operation === 'find') {
      editor.insights.openFind(false);
      const input = container.querySelector('[aria-label="Find in current file"]');
      if (!input) throw new Error('Find input is unavailable');
      input.value = '';
      input.focus();
    }
    await nextPaint();
    measurement = { operation, started: null };
    lastPaintMs = null;
  },
  async finish() {
    if (measurement?.operation === 'find') await waitForSearch();
    await nextPaint();
    if (measurement?.started === null) throw new Error('No real browser event started this measurement');
    lastPaintMs = performance.now() - measurement.started;
    const operation = measurement.operation;
    measurement = null;
    const count = container.querySelector('.sf-find-count[role="status"]')?.textContent ?? '';
    const correct = operation === 'keystroke' ? model.getText(0, 1) === 'x'
      : operation === 'paste' ? model.length === fixture.sizeBytes + pasteFixture().length
      : operation === 'undo' ? model.length === fixture.sizeBytes
      : operation === 'find' ? /(?:1 matches|1 of 1 matches)/.test(count) && editor.offset === fixture.markerOffset : true;
    if (!correct) throw new Error(`Browser ${operation} correctness failed`);
    const result = { elapsedMs: lastPaintMs, metrics: editor.highlightMetrics ?? null, length: model.length,
      searchBackend: operation === 'find' ? container.querySelector('.sf-find')?.dataset.searchBackend : undefined,
      scroll: operation === 'scroll' ? { offset: editor.view.scrollTop,
        contentFits: editor.view.scroller.scrollHeight <= editor.view.scroller.clientHeight } : undefined };
    if (operation === 'keystroke' || operation === 'paste') model.undo();
    model.undoStack.clear();
    return result;
  },
  async paste() {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', pasteFixture());
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    editor.input.dispatchEvent(event);
    return 'synthetic-clipboard-event';
  },
  async scroll() {
    const top = Math.min(200000, Math.max(0, model.lineCount - 40) * 20);
    const target = editor.view?.scroller ?? editor.input;
    if (target.scrollTop === top) target.scrollTop = 0;
    else target.scrollTop = top;
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    return 'dom-scroll';
  },
  get state() { return { length: model?.length, metrics: editor?.highlightMetrics ?? null, lastPaintMs }; },
  dispose() { editor?.dispose(); model?.dispose(); editor = null; model = null; }
};
window.editorBenchmark = api;
