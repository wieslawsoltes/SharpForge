import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, SyntaxHighlightIndex, FoldingModel, FoldingProvider, FoldingStateStore, fallbackFolding} from '@sharpforge/editor';

test('A20 incremental syntax reconverges within 200 lines in a 100000-line document', () => {
  const model = new EditorModel('int x=1;\n'.repeat(100000));
  const index = new SyntaxHighlightIndex(model.snapshot());
  const start = model.offsetAt({line: 50000, character: 6});
  const change = model.applyEdits([{start, end: start + 1, text: '42'}]);
  index.update(model.snapshot(), change);
  assert(index.metrics.relexedLines < 200, JSON.stringify(index.metrics));
  assert(index.metrics.resynced);
  const window = index.window({scrollTop: 50000 * 22, height: 400});
  assert.equal(window.runs.map(run => model.getText(run.start, run.end)).join(''), model.getText(window.start, window.end));
  assert(window.runs.some(run => run.kind === 'number' && model.getText(run.start, run.end) === '42'));
  index.dispose();
  model.dispose();
});

test('A20 incremental syntax matches full lexing after multiline literal and comment edits', () => {
  const model = new EditorModel('class C {\n  string x = "hi";\n  /* comment\n     continued */\n  int value=1;\n}\n');
  const index = new SyntaxHighlightIndex(model.snapshot());
  for (const [find, replace] of [['hi', '世界'], ['comment', 'comment */ int nested = 2; /*'], ['value', 'other']]) {
    const start = model.getText().indexOf(find);
    const change = model.applyEdits([{start, end: start + find.length, text: replace}]);
    index.update(model.snapshot(), change);
    const fresh = new SyntaxHighlightIndex(model.snapshot());
    const shape = item => item.runs.map(({start, end, kind}) => [start, end, kind]);
    assert.deepEqual(shape(index), shape(fresh));
  }
  assert.throws(() => index.window({lineHeight: 0}), RangeError);
});

test('A20 folding validates nesting and expands edits in hidden ranges', () => {
  const model = new EditorModel('a\nb\nc\nd\ne\nf\n');
  const folds = new FoldingModel();
  folds.setRanges([{startLine: 0, endLine: 5, collapsed: true}, {startLine: 1, endLine: 3},
    {startLine: 2, endLine: 6}, {startLine: -1, endLine: 2}], model.lineCount);
  assert.equal(folds.regions.length, 2);
  assert(folds.hidden(2));
  const change = model.applyEdits([{start: model.offsetAt({line: 2, character: 0}), end: model.offsetAt({line: 2, character: 0}), text: 'x\n'}]);
  folds.applyChange(change);
  assert(!folds.hidden(2));
  assert.equal(folds.regions[0].endLine, 6);
  folds.collapseAll();
  assert(folds.reveal(3));
  assert(!folds.hidden(3));
});

test('A20 folding state persists per document and fallback handles regions comments usings', () => {
  const source = 'using A;\nusing B;\n#region Test\nclass C\n{\n  /* long\n  comment */\n}\n#endregion\n';
  const model = new EditorModel(source);
  const ranges = fallbackFolding(model, new SyntaxHighlightIndex(model.snapshot()));
  assert(ranges.some(range => range.kind === 'imports' && range.startLine === 0 && range.endLine === 1));
  assert(ranges.some(range => range.kind === 'region' && range.startLine === 2 && range.endLine === 8));
  const folding = new FoldingModel();
  folding.setRanges(ranges, model.lineCount);
  folding.collapseAll();
  const state = new FoldingStateStore();
  state.save('test.cs', folding);
  folding.collapseAll(() => false);
  state.restore('test.cs', folding);
  assert(folding.regions.every(region => region.collapsed));
  state.restore('another.cs', folding);
  assert(folding.regions.every(region => !region.collapsed));
});

test('A20 folding ignores stale and disposed language responses', async () => {
  const model = new EditorModel('a\nb\nc');
  let resolve;
  const editor = {model, uri: 'x.cs', largeFile: {active: false}, folding: new FoldingModel(),
    request: () => new Promise(done => { resolve = done; })};
  const provider = new FoldingProvider(editor);
  const pending = provider.refresh();
  model.applyEdits([{start: 0, end: 0, text: 'changed'}]);
  resolve([{startLine: 0, endLine: 2}]);
  await pending;
  assert.equal(editor.folding.regions.length, 0);
  const disposed = provider.refresh();
  provider.dispose();
  resolve([{startLine: 0, endLine: 2}]);
  await disposed;
  assert.equal(editor.folding.regions.length, 0);
});

test('A20 typed folding provider cancels older requests and restores saved collapsed state after discovery', async () => {
  const model = new EditorModel('class C {\n void M() {}\n}');
  const folding = new FoldingModel();
  const state = new FoldingStateStore();
  folding.setRanges([{startLine: 0, endLine: 2, collapsed: true}], model.lineCount);
  state.save('typed.cs', folding);
  folding.setRanges([], model.lineCount);
  const signals = [];
  const editor = {model, uri: 'typed.cs', folding, largeFile: {active: false}, pendingFoldingRestore: true,
    session: {foldingState: state}, highlightIndex: {}, request() { throw new Error('Typed provider must be used'); },
    services: {supports: method => method === 'folding', invoke: async (method, parameters) => {
      signals.push(parameters.signal);
      return [{startLine: 0, endLine: 2}];
    }}};
  const provider = new FoldingProvider(editor);
  await provider.refresh();
  assert(folding.at(0).collapsed);
  await provider.refresh();
  assert(signals[0].aborted);
  provider.dispose();
  assert(signals[1].aborted);
});
