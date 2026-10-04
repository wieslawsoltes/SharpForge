import test from 'node:test';
import assert from 'node:assert/strict';
import { showControlOverlay } from '../packages/winui-controls/src/overlay/index.js';
import { setTooltipDescription } from '../packages/winui-controls/src/overlay/tooltip-description.js';

test('a second ContentDialog.ShowAsync faults while scene replay shares the outstanding operation', () => {
  const promise = new Promise(() => {});
  const state = { familyStates: new Map([['overlay', { showPromise: promise }]]) };
  const context = { getState: () => state };
  const node = { id: 'dialog', type: 'Microsoft.UI.Xaml.Controls.ContentDialog' };
  assert.equal(showControlOverlay(context, node), promise);
  assert.throws(() => showControlOverlay(context, node, { rejectConcurrent: true }), error => error.code === 'SFUI1664');
  assert.equal(state.familyStates.get('overlay').showPromise, promise);
});

test('tooltip descriptions retain independent tokens and repeated show or hide is idempotent', () => {
  const attributes = new Map([['aria-describedby', 'validation help']]);
  const target = { getAttribute: name => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name) };
  setTooltipDescription(target, 'tooltip', true);
  setTooltipDescription(target, 'tooltip', true);
  assert.equal(attributes.get('aria-describedby'), 'validation help tooltip');
  setTooltipDescription(target, 'tooltip', false);
  setTooltipDescription(target, 'tooltip', false);
  assert.equal(attributes.get('aria-describedby'), 'validation help');
  attributes.set('aria-describedby', 'tooltip');
  setTooltipDescription(target, 'tooltip', false);
  assert.equal(attributes.has('aria-describedby'), false);
});
