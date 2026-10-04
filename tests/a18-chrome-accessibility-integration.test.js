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

test('structured live capability findings preserve codes, source locations and actionable details in the Error List', () => {
  const {accessibility, view, published, announcements} = controller();
  view.path = 'View.cs';
  view.sourceSync.session.analysis.bindings = {action: {declaration: {start: 120, end: 150}}};
  const diagnostics = [
    {code: 'SFDL0010', severity: 'error', source: 'Designer', nodeId: 'action', span: null,
      capability: 'bindings', message: 'Binding cannot be materialized', fixHint: 'Keep the edit staged'},
    {code: 'SFDL0011', severity: 'error', uri: 'Other.cs', span: {start: 8, length: 5}, message: 'Stale Items'}
  ];
  accessibility.reportError({message: 'Live design remains staged', diagnostics});
  const output = published.at(-1);
  assert.equal(output[0].code, 'SFDL0010');
  assert.equal(output[0].capability, 'bindings');
  assert.equal(output[0].fixHint, 'Keep the edit staged');
  assert.equal(output[0].uri, 'View.cs');
  assert.deepEqual(output[0].span, {start: 120, end: 150});
  assert.deepEqual(output[1].span, {start: 8, end: 13});
  assert.equal(output[1].uri, 'Other.cs');
  assert.equal(diagnostics[0].span, null);
  assert.equal(announcements.at(-1), 'Live design remains staged');
});

test('standalone live errors require no source binding to remain navigable diagnostics', () => {
  const {accessibility, view, published} = controller();
  delete view.sourceSync;
  view.path = 'Live.sfdesign';
  accessibility.reportError({message: 'Items changed', diagnostic: {
    code: 'SFDL0011', severity: 'error', span: null, message: 'Items changed'
  }});
  assert.equal(published.at(-1)[0].code, 'SFDL0011');
  assert.equal(published.at(-1)[0].uri, 'Live.sfdesign');
  assert.deepEqual(published.at(-1)[0].span, {start: 0, end: 0});
});
