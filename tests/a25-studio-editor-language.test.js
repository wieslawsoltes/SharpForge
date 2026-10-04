import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioEditorBridge } from '../apps/studio/services/editor-language-bridge.js';

function cancellation() {
  const controller = new AbortController();
  const listeners = new Set();
  const signal = {
    get aborted() { return controller.signal.aborted; },
    get reason() { return controller.signal.reason; },
    addEventListener(type, listener, options) {
      assert.equal(type, 'abort');
      listeners.add(listener);
      controller.signal.addEventListener(type, listener, options);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'abort');
      listeners.delete(listener);
      controller.signal.removeEventListener(type, listener);
    }
  };
  return { signal, abort: reason => controller.abort(reason), get listeners() { return listeners.size; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('legacy editor advertises only completion and hover as data providers', async () => {
  const calls = [];
  const bridge = createStudioEditorBridge((method, parameters) => { calls.push({ method, parameters }); });
  assert.equal(bridge.services.supports('completion'), true);
  assert.equal(bridge.services.supports('hover'), true);
  for (const method of ['folding', 'foldingRanges', 'definition', 'references', 'rename', 'format',
    'codeActions', 'executeCommand', 'save', 'openDocument', 'unknown']) {
    assert.equal(bridge.services.supports(method), false);
    await assert.rejects(bridge.services.invoke(method, {}), TypeError);
  }
  assert.deepEqual(calls, []);
  assert.throws(() => createStudioEditorBridge(null), TypeError);
});

test('completion and hover keep request data intact while separating the local signal', async () => {
  const calls = [];
  const result = Object.freeze({ items: [{ label: 'WriteLine' }] });
  const bridge = createStudioEditorBridge((method, data) => {
    assert.equal(Object.hasOwn(data, 'signal'), false);
    calls.push({ method, data, cloned: structuredClone({ id: 1, method, params: data }) });
    return result;
  });
  const controller = new AbortController();
  const options = Object.freeze({ triggerCharacter: '.', includeSnippets: true });
  const parameters = Object.freeze({ uri: 'file:///Program.cs', version: 7, offset: 19, end: 23,
    options, extra: [1, null, 'retained'], signal: controller.signal });
  assert.equal(await bridge.services.invoke('completion', parameters), result);
  assert.equal(await bridge.request('hover', parameters), result);
  for (const call of calls) {
    assert.deepEqual(call.cloned.params, { uri: parameters.uri, version: 7, offset: 19, end: 23,
      options, extra: parameters.extra });
    assert.equal(call.data.options, options);
    assert.notEqual(call.data, parameters);
  }
  assert.deepEqual(calls.map(call => call.method), ['completion', 'hover']);
  assert.equal(parameters.signal, controller.signal);
  assert.equal(Object.isFrozen(parameters), true);
});

test('pre-aborted editor data requests do not dispatch or attach listeners', async () => {
  for (const method of ['completion', 'hover']) {
    for (const reason of [new Error('superseded'), false, 0, null]) {
      const local = cancellation();
      local.abort(reason);
      let dispatched = 0;
      const bridge = createStudioEditorBridge(() => { dispatched++; });
      await assert.rejects(bridge.services.invoke(method, { signal: local.signal }), error => {
        assert.equal(error.name, 'AbortError');
        assert.equal(error.cause, reason);
        return true;
      });
      assert.equal(dispatched, 0);
      assert.equal(local.listeners, 0);
    }
  }
});

test('inflight cancellation settles once, removes its listener and consumes late worker results', async () => {
  for (const failsLate of [false, true]) {
    const pending = deferred();
    const local = cancellation();
    const reason = new Error('editor revision replaced');
    let dispatched = 0;
    let fulfilled = 0;
    let rejected = 0;
    const bridge = createStudioEditorBridge(() => { dispatched++; return pending.promise; });
    const request = bridge.request('completion', { uri: 'Program.cs', offset: 2, signal: local.signal });
    const outcome = request.then(() => { fulfilled++; }, error => { rejected++; return error; });
    assert.equal(local.listeners, 1);
    local.abort(reason);
    const error = await outcome;
    assert.equal(error.name, 'AbortError');
    assert.equal(error.cause, reason);
    assert.equal(local.listeners, 0);
    if (failsLate) pending.reject(new Error('late compiler error'));
    else pending.resolve({ items: ['stale completion'] });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fulfilled, 0);
    assert.equal(rejected, 1);
    assert.equal(dispatched, 1);
  }
});

test('completion and hover remove listeners on normal settlement and preserve exact failures', async () => {
  const result = { contents: 'selected paused frame value' };
  const local = cancellation();
  const bridge = createStudioEditorBridge((method, parameters) => {
    assert.equal(method, 'hover');
    assert.equal(parameters.uri, 'Program.cs');
    return result;
  });
  assert.equal(await bridge.services.invoke('hover', { uri: 'Program.cs', signal: local.signal }), result);
  assert.equal(local.listeners, 0);
  local.abort(new Error('after settlement'));
  for (const failure of [new Error('provider failed', { cause: result }), undefined, null, false, 0]) {
    for (const asynchronous of [false, true]) {
      const requestSignal = cancellation();
      const failing = createStudioEditorBridge(() => {
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      });
      const outcome = await failing.services.invoke('completion', { signal: requestSignal.signal }).then(
        value => ({ failed: false, value }), error => ({ failed: true, error })
      );
      assert.equal(outcome.failed, true);
      assert.equal(outcome.error, failure);
      assert.equal(requestSignal.listeners, 0);
    }
  }
});

test('an abort during dispatch wins locally without cancelling the underlying host job', async () => {
  const local = cancellation();
  const pending = deferred();
  const reason = { source: 'editor disposal' };
  const bridge = createStudioEditorBridge(() => { local.abort(reason); return pending.promise; });
  await assert.rejects(bridge.request('hover', { signal: local.signal }), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.cause, reason);
    return true;
  });
  assert.equal(local.listeners, 0);
  pending.resolve({ contents: 'late data tip' });
  await Promise.resolve();
});

test('only the known missing folding RPC returns nullish fallback without worker traffic', async () => {
  const local = cancellation();
  const calls = [];
  const bridge = createStudioEditorBridge((method, parameters) => { calls.push({ method, parameters }); return 'delegated'; });
  const parameters = { uri: 'Program.cs', version: 4, signal: local.signal };
  assert.equal(bridge.services.supports('folding'), false);
  assert.equal(bridge.request('foldingRanges', parameters), null);
  local.abort();
  assert.equal(bridge.request('foldingRanges', parameters), null);
  assert.equal(local.listeners, 0);
  assert.deepEqual(calls, []);
  assert.equal(bridge.request('otherUnknownRequest', parameters), 'delegated');
  assert.deepEqual(calls, [{ method: 'otherUnknownRequest', parameters }]);
});

test('legacy host commands preserve their parameters, return values, side effects and errors', async () => {
  const commands = ['save', 'closeDocument', 'openDocument', 'nextDocument', 'previousDocument', 'findFiles',
    'format', 'definition', 'references', 'rename', 'codeActions', 'callHierarchy'];
  const signal = new AbortController().signal;
  const parameters = Object.freeze({ uri: 'Program.cs', signal, callback() {} });
  const result = { sideEffect: 'kept' };
  const calls = [];
  const bridge = createStudioEditorBridge((method, value) => { calls.push(method); assert.equal(value, parameters); return result; });
  for (const method of commands) assert.equal(bridge.request(method, parameters), result);
  assert.deepEqual(calls, commands);
  const failure = new Error('host command failed', { cause: result });
  const throwing = createStudioEditorBridge(() => { throw failure; });
  assert.throws(() => throwing.request('unknownCommand', parameters), error => error === failure);
  const rejected = Promise.reject(failure);
  const rejecting = createStudioEditorBridge(() => rejected);
  assert.equal(rejecting.request('save', parameters), rejected);
  await assert.rejects(rejected, error => error === failure);
});
