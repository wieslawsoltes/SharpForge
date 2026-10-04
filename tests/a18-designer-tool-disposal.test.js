import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerTools} from '../apps/studio/designer-tools.js';

test('tool disposal releases later resources and the owned session after earlier cleanup failures', () => {
  const view = Object.create(DesignerTools.prototype);
  const calls = [];
  const subscriptionFailure = new Error('Subscription cleanup failed');
  const accessibilityFailure = new TypeError('Illegal invocation');
  view.disposed = false;
  view.ownsSession = true;
  view.modelSubscription = () => {
    calls.push('subscription');
    throw subscriptionFailure;
  };
  view.resizeObserver = {disconnect() { calls.push('observer'); }};
  view.surface = {dispose() { calls.push('surface'); }};
  view.accessibility = {dispose() {
    calls.push('accessibility');
    throw accessibilityFailure;
  }};
  view.assetPreviews = {dispose() { calls.push('assets'); }};
  view.host = {dispose() { calls.push('host'); }};
  view.menu = {close() { calls.push('menu'); }};
  view.session = {dispose() { calls.push('session'); }};
  assert.throws(() => view.dispose(), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [subscriptionFailure, accessibilityFailure]);
    return true;
  });
  assert.deepEqual(calls, ['subscription', 'observer', 'surface', 'accessibility', 'assets', 'host', 'menu', 'session']);
  assert.equal(view.disposed, true);
  assert.doesNotThrow(() => view.dispose());
  assert.equal(calls.length, 8);
});

test('partial tool disposal tolerates resources that were not constructed and leaves a shared session owned by its registry', () => {
  const view = Object.create(DesignerTools.prototype);
  let disposedSessions = 0;
  view.disposed = false;
  view.ownsSession = false;
  view.session = {dispose() { disposedSessions++; }};
  assert.doesNotThrow(() => view.dispose());
  assert.equal(view.disposed, true);
  assert.equal(disposedSessions, 0);
});
