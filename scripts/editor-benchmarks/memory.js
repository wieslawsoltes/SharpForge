import { TextBuffer } from '@sharpforge/text';
import { EditorModel, SyntaxHighlightIndex, VisualLineMap } from '@sharpforge/editor';
import { setImmediate as yieldThread } from 'node:timers/promises';
import { createEditorFixture } from './fixtures.js';
import { editorBenchmarkSizes, environment, schemaVersion, validateOptions } from './common.js';
import { retainedMetric, evaluateMemoryBudgets } from './memory-budget.js';

export function captureMemory() {
  const usage = process.memoryUsage();
  return { heapUsedBytes: usage.heapUsed, arrayBufferBytes: usage.arrayBuffers, externalBytes: usage.external, rssBytes: usage.rss };
}

export function memoryDelta(after, before) {
  return Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
}

async function collect(gc) {
  gc();
  await yieldThread();
  gc();
  return captureMemory();
}

/** GC retained deltas are explicitly distinct from allocation counts and native/DOM memory. */
export async function benchmarkEditorMemory({ sizes = editorBenchmarkSizes, undoSteps = 100, tokenFactory = createTokenIndex, gc = globalThis.gc,
  signal, onProgress = () => {} } = {}) {
  if (typeof gc !== 'function') throw Object.assign(new Error('Retained-memory benchmark requires node --expose-gc'), { code: 'EDITOR_BENCH_GC_REQUIRED' });
  sizes = validateOptions({ sizes }).sizes;
  if (!Number.isSafeInteger(undoSteps) || undoSteps < 1 || undoSteps > 1000) throw new RangeError('Invalid undo step count');
  const rows = [];
  for (const sizeBytes of sizes) {
    if (signal?.aborted) throw new Error('Editor memory benchmark cancelled');
    onProgress(`Node retained memory ${sizeBytes} bytes`);
    const baseline = await collect(gc);
    let fixture = createEditorFixture(sizeBytes);
    const source = await collect(gc);
    let buffer = new TextBuffer(fixture.text, { uri: fixture.uri });
    const bufferMemory = await collect(gc);
    let model = new EditorModel('', { buffer, undo: { maxOperations: undoSteps + 1, coalesceMs: 0 } });
    const modelMemory = await collect(gc);
    for (let index = 0; index < undoSteps; index++) {
      const position = (index * 97) % Math.max(1, sizeBytes - 1);
      model.applyEdits([{ start: position, end: position, text: `/* edit ${index} */` }], { command: 'benchmark', undoStop: true });
    }
    const withUndo = await collect(gc);
    const undoStatistics = model.undoStack.statistics;
    model.undoStack.clear();
    const withoutUndo = await collect(gc);
    let tokens = null;
    let view = null;
    let tokenResult = { status: 'unavailable', reason: 'No headless token-cache adapter supplied; full syntax materialization is not substituted' };
    if (tokenFactory) {
      const beforeTokens = await collect(gc);
      tokens = await tokenFactory(model);
      const afterTokens = await collect(gc);
      tokenResult = { status: 'measured', backend: tokens.backend,
        ...retainedMetric(memoryDelta(afterTokens, beforeTokens), sizeBytes), statistics: tokens.statistics ?? null };
    }
    const beforeView = await collect(gc);
    view = new VisualLineMap(model.lineCount);
    const afterView = await collect(gc);
    const viewDelta = memoryDelta(afterView, beforeView);
    const bufferDelta = memoryDelta(bufferMemory, baseline);
    const undoDelta = memoryDelta(withUndo, withoutUndo);
    const undoPerStep = (undoDelta.heapUsedBytes + undoDelta.arrayBufferBytes) / undoSteps;
    const row = { backend: 'node-retained', sizeBytes, gc: 'two explicit V8 major collection requests per stage',
      source: { status: 'measured', ...retainedMetric(memoryDelta(source, baseline), sizeBytes) },
      buffer: { status: 'measured', ...retainedMetric(bufferDelta, sizeBytes),
        indexOnlyDelta: memoryDelta(bufferMemory, source), statistics: buffer.statistics },
      model: { status: 'measured', ...retainedMetric(memoryDelta(modelMemory, bufferMemory), sizeBytes) },
      undo: { status: 'measured', ...retainedMetric(undoDelta, sizeBytes), steps: undoSteps, bytesPerStep: undoPerStep, statistics: undoStatistics },
      tokens: tokenResult,
      view: { status: 'measured', backend: 'VisualLineMap', ...retainedMetric(viewDelta, sizeBytes), logicalLines: view.lineCount,
        indexedBytes: view.counts.byteLength + view.tree.byteLength, scope: 'Logical-to-visual row index; DOM and native renderer excluded' },
      browserDom: { status: 'unavailable', reason: 'Node has no DOM; browser DOM retained memory requires browser heap instrumentation' },
      allocations: { status: 'not-measured', reason: 'Retained GC deltas do not measure total allocations' } };
    row.budgets = evaluateMemoryBudgets(row);
    rows.push(row);
    tokens?.dispose?.();
    model.dispose();
    buffer.dispose();
    tokens = null;
    view = null;
    model = null;
    buffer = null;
    fixture = null;
    await collect(gc);
  }
  return { schemaVersion, kind: 'sharpforge-editor-memory', generatedAt: new Date().toISOString(), environment: environment(),
    methodology: 'Measured signed GC-retained heap/ArrayBuffer deltas. Sources are ASCII. Undo attribution clears history while preserving current text.',
    rows, correctness: { passed: rows.every(row => row.budgets.passed) },
    unsupported: ['total-allocation-counts', 'native-allocator', 'browser-DOM-in-node'] };
}

function createTokenIndex(model) {
  const index = new SyntaxHighlightIndex(model.snapshot());
  const window = index.window({ scrollTop: 0, height: 800, lineHeight: 20 });
  return {
    index,
    window,
    backend: index.tokens ? 'compiler-token-index' : 'plain-text-large-file',
    statistics: { tokenCount: index.tokens?.length ?? 0, visibleRuns: window.runs.length,
      lexicalCharacterLimit: index.maxLexCharacters, syntaxEnabled: Boolean(index.tokens), metrics: index.metrics },
    dispose: () => index.dispose()
  };
}
