import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {restoreInputFocus} from './support/a20-input-view.js';
import {geometryView, geometryAtCaret} from './support/a20-input-geometry.js';

function fixture(text, options = {}) {
  const documents = new DocumentService({records: [{uri: 'Program.cs', text, version: 1}],
    createModel: record => new EditorModel(record.text, {uri: record.uri})});
  const model = documents.models.get('Program.cs');
  const views = [];
  return {documents, model, views,
    view(caret = model.length, onEdit) {
      const editor = geometryView(model, [{anchor: caret, active: caret}], options, onEdit);
      views.push(editor);
      return editor;
    },
    dispose() { for (const editor of views) editor.dispose(); documents.dispose(); }
  };
}

test('owner refocus sees real committed line geometry for growth and shrink before normal view publication', () => {
  const state = fixture('old');
  const order = [];
  const editor = state.view(3, () => order.push('view'));
  const observed = [];
  const offFold = editor.folding.onDidChange(() => order.push('fold'));
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    order.push('owner');
    restoreInputFocus(editor);
    observed.push(geometryAtCaret(editor));
  });
  try {
    editor.applyEdits([{start: 0, end: 3, text: 'first\nsecond\nlast'}], {selections: [{anchor: 17, active: 17}]});
    assert.equal(observed[0].lineCount, 3);
    assert.equal(observed[0].source, 'last');
    assert.equal(observed[0].coords.top, editor.padding + 2 * editor.view.metrics.lineHeight);
    editor.applyEdits([{start: 0, end: 17, text: 'x'}], {selections: [{anchor: 1, active: 1}]});
    assert.equal(observed[1].lineCount, 1);
    assert.equal(observed[1].source, 'x');
    assert.equal(observed[1].coords.top, editor.padding);
    assert.deepEqual(order, ['owner', 'fold', 'view', 'owner', 'fold', 'view']);
    assert.throws(() => editor.view.layout.map.set(1, 1), /Invalid visual line/);
    assert.throws(() => state.model.getText(3, 1), RangeError);
  } finally { remove(); offFold(); state.dispose(); }
});

test('same-size text replacement invalidates cached width before owner input synchronization', () => {
  const state = fixture('aa');
  const editor = state.view();
  const before = geometryAtCaret(editor);
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type === 'changed') { restoreInputFocus(editor); observed.push(geometryAtCaret(editor)); }
  });
  try {
    editor.applyEdits([{start: 0, end: 2, text: '\t中'}], {selections: [{anchor: 2, active: 2}]});
    assert.equal(observed[0].lineCount, 1);
    assert.equal(observed[0].source, '\t中');
    assert.equal(observed[0].coords.left, editor.padding + 6 * editor.view.metrics.charWidth);
    assert.ok(observed[0].coords.left > before.coords.left);
    assert.deepEqual(geometryAtCaret(editor), observed[0], 'The late listener does not restore the old cache');
  } finally { remove(); state.dispose(); }
});

test('owner geometry includes transformed folds, leading zones, wrapping and current scroll extent', () => {
  const state = fixture('head\nbody\nend\ntail', {wordWrap: true});
  const editor = state.view();
  editor.folding.setRanges([{startLine: 0, endLine: 2, collapsed: true}], state.model.lineCount);
  editor.viewZones.set('test', [{afterLine: -1, height: 44}]);
  editor.view.layout.applyZones();
  editor.view.layout.configure(28);
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    restoreInputFocus(editor);
    observed.push({geometry: geometryAtCaret(editor), folds: editor.folding.regions.map(region => ({...region})),
      height: parseFloat(editor.view.surface.style.height)});
  });
  try {
    const text = 'more\n';
    editor.applyEdits([{start: 0, end: 0, text}], {selections: [{anchor: 5, active: 5}]});
    assert.equal(observed[0].geometry.lineCount, 5);
    assert.equal(observed[0].folds[0].collapsed, false, 'Editing the fold opens it before owner geometry queries');
    assert.equal(observed[0].folds[0].endLine, 3);
    assert.equal(editor.view.layout.leadingRows, 2);
    assert.equal(observed[0].geometry.coords.top, editor.padding + 4 * editor.view.metrics.lineHeight);
    assert.ok(observed[0].height >= 7 * editor.view.metrics.lineHeight + editor.padding * 2);
    assert.equal(editor.view.layout.line(1).segments.length, 2, 'Real wrapping contributes visual rows');
  } finally { remove(); state.dispose(); }
});

test('grouped undo and redo prepare final real geometry once for every intermediate owner notification', () => {
  const state = fixture('base', {wordWrap: true});
  const editor = state.view();
  const independent = state.view(1);
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    for (const view of [editor, independent]) {
      restoreInputFocus(view);
      view.view.layout.flushWrap();
      observed.push(geometryAtCaret(view));
    }
  });
  try {
    state.model.beginUndoGroup('multiline intermediate source');
    editor.applyEdits([{start: 4, end: 4, text: '\nline'.repeat(12)}], {selections: [{anchor: 64, active: 64}]});
    editor.applyEdits([{start: 0, end: 64, text: 'end'}], {selections: [{anchor: 3, active: 3}]});
    state.model.endUndoGroup();
    observed.length = 0;
    const before = editor.view.layout.generation;
    assert.equal(editor.undo(), true);
    assert.equal(editor.view.layout.generation, before + 1, 'Intermediate callbacks do not reset the final layout again');
    assert.equal(observed.length, 4);
    assert.ok(observed.every(value => value.lineCount === 1 && value.source === 'base'));
    assert.equal(editor.view.layout.wrapRanges.length, 0);
    observed.length = 0;
    assert.equal(editor.undo(true), true);
    assert.ok(observed.every(value => value.lineCount === 1 && value.source === 'end'));
    assert.equal(editor.view.layout.wrapRanges.length, 0);
  } finally { remove(); state.dispose(); }
});

test('nested owner edits retain the newest real geometry when the outer model listener resumes', () => {
  const state = fixture('a\nb');
  const editor = state.view();
  let nested = false;
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    if (!nested) {
      nested = true;
      state.model.applyEdits([{start: 0, end: state.model.length, text: '\t中'}]);
    }
    restoreInputFocus(editor);
    observed.push(geometryAtCaret(editor));
  });
  try {
    state.model.applyEdits([{start: 3, end: 3, text: '\nc'}]);
    assert.equal(observed.length, 2);
    assert.ok(observed.every(value => value.lineCount === 1 && value.source === '\t中'));
    assert.deepEqual(geometryAtCaret(editor), observed[1]);
  } finally { remove(); state.dispose(); }
});

test('owner-time rebind and disposal retire geometry preparation without changing strict current failures', () => {
  const state = fixture('old');
  const editor = state.view();
  const next = new EditorModel('next\nmodel', {uri: 'Next.cs'});
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    editor.setModel(next.uri, next);
    editor.setSelections([{anchor: next.length, active: next.length}]);
    restoreInputFocus(editor);
  });
  try {
    state.model.applyEdits([{start: 3, end: 3, text: '\nold line'}]);
    assert.equal(geometryAtCaret(editor).lineCount, 2);
    assert.equal(geometryAtCaret(editor).source, 'model');
    next.applyEdits([{start: 0, end: next.length, text: 'new'}]);
    assert.equal(geometryAtCaret(editor).source, 'new');
    const generation = editor.view.layout.generation;
    editor.dispose();
    next.applyEdits([{start: 3, end: 3, text: '\nafter disposal'}]);
    assert.equal(editor.view.layout.generation, generation + 1, 'Only disposal advances the retired layout');
  } finally { remove(); state.dispose(); next.dispose(); }
});

test('owner focus uses the updated physical scroll scale after committed line growth', () => {
  const state = fixture('one\ntwo');
  const editor = state.view();
  editor.view.metrics.configure({lineHeight: 10_000_000});
  editor.view.layout.reset();
  editor.view.scroll.update([]);
  editor.view.scrollTo({top: 1_000_000});
  const previousScale = editor.view.scroll.scale;
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    restoreInputFocus(editor);
    observed.push({geometry: geometryAtCaret(editor), scale: editor.view.scroll.scale, top: editor.view.scrollTop});
  });
  try {
    editor.applyEdits([{start: 7, end: 7, text: '\nthree'}], {selections: [{anchor: 13, active: 13}]});
    const logical = 30_000_000 + editor.padding * 2;
    const expectedScale = (logical - 120) / (16_000_000 - 120);
    assert.equal(observed[0].scale, expectedScale);
    assert.ok(observed[0].scale > previousScale);
    assert.ok(Math.abs(observed[0].top - 1_000_000) < 0.001);
    assert.ok(Math.abs(observed[0].geometry.coords.top - (editor.padding + 19_000_000)) < 0.001);
    assert.equal(editor.view.surface.style.height, '16000000px');
  } finally { remove(); state.dispose(); }
});

test('owner focus preserves horizontal scroll when an edited long line is the only measured extent', () => {
  const state = fixture('x'.repeat(2000));
  const editor = state.view(1200);
  editor.view.scroll.update(editor.view.layout.rows(0, 120));
  editor.view.viewport.scrollLeft = 4000;
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    restoreInputFocus(editor);
    observed.push({left: editor.view.viewport.scrollLeft, width: parseFloat(editor.view.surface.style.width)});
  });
  try {
    assert.equal(editor.view.viewport.scrollLeft, 4000);
    editor.applyEdits([{start: 1200, end: 1201, text: 'y'}], {selections: [{anchor: 1201, active: 1201}]});
    assert.equal(observed[0].left, 4000, 'The scroll surface must never transiently collapse to the viewport width');
    assert.ok(observed[0].width > 4000 + editor.view.viewport.clientWidth);
    editor.applyEdits([{start: 0, end: 2000, text: 'short'}], {selections: [{anchor: 5, active: 5}]});
    assert.equal(observed[1].left, 0, 'A genuinely short replacement retires the old extent');
    assert.equal(observed[1].width, editor.view.viewport.clientWidth);
  } finally { remove(); state.dispose(); }
});

test('first owner focus includes new wrapped rows above the caret without flushing deferred wrap work', () => {
  const state = fixture('a\nb', {wordWrap: true});
  const editor = state.view();
  editor.view.layout.configure(28);
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    restoreInputFocus(editor);
    observed.push({top: parseFloat(editor.input.style.top), row: editor.view.layout.position(editor.caretOffset).row});
  });
  try {
    editor.applyEdits([{start: 1, end: 1, text: 'aaaa'}], {selections: [{anchor: 7, active: 7}]});
    assert.equal(observed[0].row, 3, 'Five characters wrap as three grapheme-safe visual rows at this width');
    assert.equal(observed[0].top, editor.padding + 3 * editor.view.metrics.lineHeight);
    assert.equal(editor.view.layout.line(0).segments.length, 3);
  } finally { remove(); state.dispose(); }
});
