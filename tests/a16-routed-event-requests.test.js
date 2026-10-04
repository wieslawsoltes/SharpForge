import test from 'node:test';
import assert from 'node:assert/strict';
import {RoutedEventRouter, RoutingStrategy} from '@sharpforge/winui-controls';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function fixture(options = {}) {
  const active = new Set(['root', 'child']);
  const router = new RoutedEventRouter({contains: id => active.has(id), parentOf: id => id === 'child' ? 'root' : null, ...options});
  return {router, active};
}

test('acknowledged routes preserve order, shared argument identity and handled-events-too subscriptions', async () => {
  const {router} = fixture();
  const gate = deferred(), order = [], argumentsSeen = [];
  const first = router.addHandler('child', 'ContextRequested', async (id, args) => {
    order.push('first-start');
    argumentsSeen.push(args);
    await gate.promise;
    args.Handled = true;
    order.push('first-end');
  });
  router.addHandler('child', 'ContextRequested', () => order.push('ordinary'));
  router.addHandler('child', 'ContextRequested', (id, args) => {
    order.push('child-handled');
    argumentsSeen.push(args);
  }, {handledEventsToo: true});
  router.addHandler('root', 'ContextRequested', (id, args) => {
    order.push('root-handled');
    argumentsSeen.push(args);
    assert.equal(args.Source, 'root');
  }, {handledEventsToo: true});
  const pending = router.raiseAsync('child', 'ContextRequested', {Position: {X: 3, Y: 4}});
  assert.deepEqual(order, ['first-start']);
  gate.resolve();
  const result = await pending;
  assert.deepEqual(order, ['first-start', 'first-end', 'child-handled', 'root-handled']);
  assert.equal(result.Handled, true);
  assert.equal(result.OriginalSource, 'child');
  assert.deepEqual(result.Route, ['child', 'root']);
  assert.ok(argumentsSeen.every(value => value === result));
  assert.equal(first.order, 1);
  first();
  router.dispose();
});

test('abort, node removal and disposal stop remaining callbacks after a pending subscription', async () => {
  for (const action of ['abort', 'remove', 'dispose']) {
    const gate = deferred(), controller = new AbortController(), called = [];
    const {router, active} = fixture({onDispatch: () => called.push('dispatch')});
    router.addHandler('child', 'Click', () => gate.promise);
    router.addHandler('child', 'Click', () => called.push('later'));
    const pending = router.raiseAsync('child', 'Click', {}, RoutingStrategy.Bubble, {signal: controller.signal});
    const failed = assert.rejects(pending, /superseded|no longer active/);
    if (action === 'abort') controller.abort(new Error('superseded'));
    if (action === 'remove') active.delete('child');
    if (action === 'dispose') router.dispose();
    gate.resolve();
    await failed;
    assert.deepEqual(called, [], action);
    router.dispose();
  }
});

test('direct and tunnel decisions share ancestry limits without changing synchronous dispatch', async () => {
  const {router} = fixture();
  const calls = [];
  router.addHandler('root', 'Closing', id => calls.push(id));
  router.addHandler('child', 'Closing', id => calls.push(id));
  await router.raiseAsync('child', 'Closing', {}, RoutingStrategy.Direct);
  assert.deepEqual(calls, ['child']);
  calls.length = 0;
  await router.raiseAsync('child', 'Closing', {}, RoutingStrategy.Tunnel);
  assert.deepEqual(calls, ['root', 'child']);
  calls.length = 0;
  assert.equal(router.raise('child', 'Closing').Handled, false);
  assert.deepEqual(calls, ['child', 'root']);
  await assert.rejects(router.raiseAsync('absent', 'Closing'), /no longer active/);
  router.parentOf = id => id === 'child' ? 'root' : 'child';
  await assert.rejects(router.raiseAsync('child', 'Closing'), /ancestry/);
  const bounded = fixture({maximumDepth: 1}).router;
  await assert.rejects(bounded.raiseAsync('child', 'Closing'), /ancestry/);
  bounded.dispose();
  router.dispose();
});
