import { EditorModel } from '@sharpforge/editor';
import { findTextMatches } from '@sharpforge/text';
import { setImmediate as yieldThread } from 'node:timers/promises';
import { createEditorFixture, pasteFixture, searchMarker } from './fixtures.js';
import { distribution, environment, schemaVersion, validateOptions } from './common.js';

async function measure(operation, options) {
  const { samples, warmups, signal } = options;
  const run = () => {
    if (signal?.aborted) throw new Error('Editor benchmark cancelled');
    operation.prepare?.();
    const before = performance.now();
    const value = operation.run();
    const elapsed = performance.now() - before;
    operation.verify?.(value);
    operation.cleanup?.();
    return elapsed;
  };
  const coldMs = run();
  for (let index = 0; index < warmups; index++) run();
  const rawSamplesMs = [];
  for (let index = 0; index < samples; index++) rawSamplesMs.push(run());
  return { operation: operation.name, coldMs, ...distribution(rawSamplesMs), rawSamplesMs, correctness: { passed: true } };
}

export async function benchmarkEditorModel(options = {}) {
  const settings = { ...validateOptions(options), signal: options.signal };
  const rows = [];
  const pasted = pasteFixture();
  for (const sizeBytes of settings.sizes) {
    if (settings.signal?.aborted) throw new Error('Editor benchmark cancelled');
    options.onProgress?.(`Node model ${sizeBytes} bytes`);
    const fixture = createEditorFixture(sizeBytes);
    const started = performance.now();
    const model = new EditorModel(fixture.text, { uri: fixture.uri, undo: { maxOperations: 1000, coalesceMs: 0 } });
    const createMs = performance.now() - started;
    const position = Math.floor(sizeBytes / 3);
    const edit = text => model.applyEdits([{ start: position, end: position, text }], { command: 'benchmark', undoStop: true });
    const cleanup = () => {
      if (!model.undo() || model.length !== sizeBytes) throw new Error('Benchmark undo did not restore source length');
      model.undoStack.clear();
    };
    let viewportIndex = 0;
    const operations = [
      { name: 'model.edit', run: () => edit('x'), cleanup,
        verify: () => { if (model.getText(position, position + 1) !== 'x') throw new Error('Keystroke correctness failed'); } },
      { name: 'model.paste64KiB', run: () => edit(pasted), cleanup,
        verify: () => { if (model.length !== sizeBytes + pasted.length) throw new Error('Paste length mismatch'); } },
      { name: 'model.undo64KiB', prepare: () => edit(pasted), run: () => model.undo(),
        verify: value => { if (!value || model.length !== sizeBytes) throw new Error('Undo correctness failed'); },
        cleanup: () => model.undoStack.clear() },
      { name: 'model.findLiteral', run: () => findTextMatches([model.snapshot()], searchMarker,
        { matchCase: true, maxMatches: 2, maxSteps: 1_000_000_000, timeLimitMs: 30_000 }),
      verify: value => {
        if (value.matches.length !== 1 || value.matches[0].start !== fixture.markerOffset) throw new Error('Find result mismatch');
      } },
      { name: 'model.viewportQuery60Lines', run: () => {
        const maximum = Math.max(1, model.lineCount - 60);
        const firstLine = Math.floor((viewportIndex++ % 11) * maximum / 11);
        let characters = 0;
        for (let line = firstLine; line < Math.min(model.lineCount, firstLine + 60); line++) characters += model.getLine(line).length;
        return characters;
      }, verify: value => { if (value < 1) throw new Error('Viewport query was empty'); } }
    ];
    for (const operation of operations) {
      const result = await measure(operation, settings);
      rows.push({ ...result, backend: 'node-model', sizeBytes, createMs, implementation: 'EditorModel/TextBuffer',
        description: operation.name.includes('viewport') ? 'Indexed text lookup only; no layout, paint or browser scrolling'
          : 'Synchronous model operation; no browser paint' });
    }
    model.dispose();
    await yieldThread();
  }
  return { schemaVersion, kind: 'sharpforge-editor-latency', generatedAt: new Date().toISOString(), environment: environment(),
    methodology: 'One cold sample, explicit warmups, then nearest-rank p50/p95/p99 over retained raw samples. Model timings exclude browser events and paint.',
    configuration: settings, correctness: { passed: true }, rows, unsupported: ['browser-paint-in-node', 'native-desktop'] };
}
