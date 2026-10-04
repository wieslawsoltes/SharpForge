import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '../packages/editor/src/model.js';
import {IncrementalSearchWidget} from '../packages/editor/src/widgets/incremental-search.js';

function fixture(t, text, {origin = 0, end = origin, direction = 1, searchNavigation = {}, navigate} = {}) {
  const model = new EditorModel(text, {uri: 'search.cs'});
  const models = new Set([model]);
  model.setSelections([{anchor: origin, active: end}]);
  const editor = {
    model, disposed: false,
    get uri() { return this.model.uri; },
    get offset() { return this.model.primarySelection.start; },
    get value() { throw new Error('Incremental search must use the indexed source'); },
    sourceSnapshot() { return this.model.snapshot(); },
    goto(start, finish = start) { this.model.setSelections([{anchor: start, active: finish}]); },
    focus() {}
  };
  editor.input = {get selectionEnd() { return editor.model.primarySelection.end; }};
  const navigations = [];
  const errors = [];
  const widget = Object.create(IncrementalSearchWidget.prototype);
  widget.context = {
    editor, options: {searchNavigation: {clock: () => 0, ...searchNavigation}},
    async navigate(location, options) {
      navigations.push({location, options});
      if (navigate) return await navigate(location, options);
      editor.goto(location.start, location.end);
    },
    async safe(callback) { try { return await callback(); } catch (error) { errors.push(error); } }
  };
  widget.input = {value: '', focus() {}};
  widget.status = {textContent: ''};
  widget.popup = {
    visible: false, show() { this.visible = true; }, close() { this.visible = false; },
    dispose() { this.visible = false; }
  };
  widget.open(direction);
  t.after(() => { widget.dispose(); for (const value of models) value.dispose(); });
  return {
    widget, editor, model, navigations, errors,
    search(query, repeat = false) { widget.input.value = query; return widget.search(repeat); },
    replaceModel(value) {
      const replacement = new EditorModel(value, {uri: editor.uri, version: editor.model.version});
      models.add(replacement);
      editor.model = replacement;
      return replacement;
    }
  };
}

function holdFirstYield() {
  let release;
  let held = false;
  const pending = new Promise(resolve => { release = resolve; });
  return {release, get held() { return held; }, yieldControl() {
    if (held) return Promise.resolve();
    held = true;
    return pending;
  }};
}

const selection = editor => [editor.model.primarySelection.start, editor.model.primarySelection.end];

test('incremental forward search begins at a large origin and repeats beyond 10000 matches before wrapping', async t => {
  const {search, editor, widget, model} = fixture(t, 'x '.repeat(10002), {origin: 20000});
  await search('x');
  assert.deepEqual(selection(editor), [20000, 20001]);
  assert.equal(widget.status.textContent, 'Forward: x');
  await search('x', true);
  assert.deepEqual(selection(editor), [20002, 20003]);
  assert.equal(widget.status.textContent, 'Forward: x');
  await search('x', true);
  assert.deepEqual(selection(editor), [0, 1]);
  assert.equal(widget.status.textContent, 'Forward: x · wrapped');
  assert.equal(model.undoStack.depth, 0);
});

test('incremental reverse search selects the nearest preceding match and wraps from the actual caret', async t => {
  const {search, editor, widget} = fixture(t, 'x '.repeat(10002), {origin: 20000, direction: -1});
  await search('x');
  assert.deepEqual(selection(editor), [19998, 19999]);
  assert.equal(widget.status.textContent, 'Backward: x');
  await search('x', true);
  assert.deepEqual(selection(editor), [19996, 19997]);
  editor.goto(0);
  await search('x', true);
  assert.deepEqual(selection(editor), [20002, 20003]);
  assert.equal(widget.status.textContent, 'Backward: x · wrapped');
});

test('extending and shortening an incremental query always returns to the opening origin', async t => {
  const {search, editor, model} = fixture(t, 'ab abc abcd');
  await search('abcd');
  assert.deepEqual(selection(editor), [7, 11]);
  await search('ab');
  assert.deepEqual(selection(editor), [0, 2]);
  await search('ab', true);
  assert.deepEqual(selection(editor), [3, 5]);
  await search('AB');
  assert.deepEqual(selection(editor), [0, 2]);
  assert.equal(model.getText(), 'ab abc abcd');
  assert.equal(model.version, 1);
});

test('cancel restores the opening range, while accepting preserves the selected match without edits', async t => {
  const {search, editor, widget, model, errors} = fixture(t, 'ab abc abcd', {origin: 3, end: 6});
  await search('abcd');
  assert.deepEqual(selection(editor), [7, 11]);
  widget.close(true);
  assert.deepEqual(selection(editor), [3, 6]);
  assert.equal(widget.searchController.signal.aborted, true);
  assert.equal(widget.popup.visible, false);
  widget.open();
  await search('abcd');
  widget.close(false);
  assert.deepEqual(selection(editor), [7, 11]);
  assert.equal(model.version, 1);
  assert.deepEqual(errors, []);
});

test('an explicit navigation budget failure leaves the original selection and displays the limit', async t => {
  const {search, editor, widget, model, navigations} = fixture(t, 'x '.repeat(10002), {
    origin: 20000, searchNavigation: {maxSteps: 1}
  });
  await search('missing');
  assert.deepEqual(selection(editor), [20000, 20000]);
  assert.equal(widget.status.textContent, 'Search step limit exceeded');
  assert.equal(navigations.length, 0);
  assert.equal(model.version, 1);
});

test('an exhausted scope and an empty query display their result without moving the caret', async t => {
  const {search, editor, widget, navigations} = fixture(t, 'abc', {origin: 1});
  await search('missing');
  assert.equal(widget.status.textContent, 'No match');
  await search('');
  assert.equal(widget.status.textContent, 'Type to search');
  assert.deepEqual(selection(editor), [1, 1]);
  assert.equal(navigations.length, 0);
});

for (const change of ['edit', 'replace model']) test(`a delayed incremental result is discarded after ${change}`, async t => {
  const hold = holdFirstYield();
  const scope = fixture(t, 'x'.repeat(600) + 'needle', {searchNavigation: {chunkSize: 256, yieldControl: hold.yieldControl}});
  const pending = scope.search('needle');
  assert.equal(hold.held, true);
  if (change === 'edit') scope.model.applyEdits([{start: 0, end: 0, text: '!'}]);
  else scope.replaceModel('replacement with the same URI and version');
  hold.release();
  await pending;
  assert.equal(scope.navigations.length, 0);
  assert.equal(scope.widget.status.textContent, 'Incremental search forward');
});

test('a newer incremental query supersedes a delayed search without stale navigation or status', async t => {
  const hold = holdFirstYield();
  const {search, widget, editor, navigations} = fixture(t, 'x'.repeat(600) + 'needle', {
    searchNavigation: {chunkSize: 256, yieldControl: hold.yieldControl}
  });
  const older = search('needle');
  assert.equal(hold.held, true);
  const oldController = widget.searchController;
  await search('x');
  assert.equal(oldController.signal.aborted, true);
  hold.release();
  await older;
  assert.equal(navigations.length, 1);
  assert.deepEqual(selection(editor), [0, 1]);
  assert.equal(widget.status.textContent, 'Forward: x');
});

for (const action of ['close', 'dispose']) test(`${action} cancels a pending search and prevents subsequent late results`, async t => {
  const hold = holdFirstYield();
  const {search, widget, navigations} = fixture(t, 'x'.repeat(600) + 'needle', {
    searchNavigation: {chunkSize: 256, yieldControl: hold.yieldControl}
  });
  const pending = search('needle');
  assert.equal(hold.held, true);
  if (action === 'close') widget.close(false);
  else widget.dispose();
  assert.equal(widget.searchController.signal.aborted, true);
  hold.release();
  await pending;
  await search('x');
  assert.equal(navigations.length, 0);
  assert.equal(widget.popup.visible, false);
});

test('host navigation failures are handled inside the incremental request and reported to the user', async t => {
  const {search, widget, editor} = fixture(t, ' x', {navigate: async () => { throw new Error('Host navigation failed'); }});
  await search('x');
  assert.equal(widget.status.textContent, 'Host navigation failed');
  assert.deepEqual(selection(editor), [0, 0]);
});

test('closing during asynchronous host navigation passes cancellation and suppresses a stale status', async t => {
  let release;
  const pendingNavigation = new Promise(resolve => { release = resolve; });
  const {search, widget, navigations} = fixture(t, ' x', {navigate: () => pendingNavigation});
  const pending = search('x');
  await Promise.resolve();
  assert.equal(navigations.length, 1);
  const signal = navigations[0].options.signal;
  widget.close(false);
  assert.equal(signal.aborted, true);
  release();
  await pending;
  assert.equal(widget.status.textContent, 'Incremental search forward');
});
