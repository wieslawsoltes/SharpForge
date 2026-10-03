import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign} from '@sharpforge/designer';
import {DesignerAccessibility} from '../apps/studio/designer-accessibility.js';

function controller() {
  const published = [];
  const announcements = [];
  const view = {
    document: new DesignDocument(createDesign()), preview: false,
    sourceSync: {session: {analysis: {diagnostics: []}}},
    publishDesignerDiagnostics: diagnostics => published.push(diagnostics),
    safe: action => action(), reorder: delta => announcements.push(delta)
  };
  const accessibility = new DesignerAccessibility(view);
  accessibility.announce = message => announcements.push(message);
  return {accessibility, view, published, announcements};
}

test('already adapted worker diagnostics remain navigable without reinterpreting the public analysis snapshot', () => {
  const {accessibility, view, published} = controller();
  const warning = {
    code: 'SFD0002', severity: 'warning', uri: 'View.cs', span: {start: 42, end: 59},
    message: 'Protected source expression', fixHint: 'Edit the expression in source', source: 'Designer'
  };
  const state = {state: 'synced', message: 'Source linked', diagnostics: [warning]};
  accessibility.syncChanged(state);
  assert.deepEqual(published.at(-1), [warning]);
  assert.notEqual(accessibility.sourceDiagnostics, state.diagnostics);
  view.sourceSync.session.analysis.diagnostics = [warning];
  accessibility.syncChanged({state: 'synced', message: 'Source unchanged'});
  assert.deepEqual(published.at(-1), [warning]);
  accessibility.syncChanged({...state, diagnostics: []});
  assert.deepEqual(published.at(-1), []);
});

test('geometry arrows remain with Surface gestures while Alt+arrow keeps accessible sibling reorder', () => {
  const {accessibility, announcements} = controller();
  let prevented = 0;
  let stopped = 0;
  const event = {
    key: 'ArrowRight', preventDefault: () => prevented++, stopPropagation: () => stopped++, target: {closest: () => null}
  };
  for (const modifiers of [{}, {ctrlKey: true}, {shiftKey: true}, {ctrlKey: true, shiftKey: true}, {repeat: true}]) {
    assert.equal(accessibility.handleKey({...event, ...modifiers}), false);
  }
  assert.equal(prevented, 0);
  assert.equal(stopped, 0);
  assert.equal(accessibility.handleKey({...event, altKey: true}), true);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.deepEqual(announcements, [1]);
});
