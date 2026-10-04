import test from 'node:test';
import assert from 'node:assert/strict';
import {HostEventRequests} from '../packages/winui-controls/src/host/event-requests.js';
import {registerControlFamilyAdapters} from '@sharpforge/winui-controls';
import {JavaScriptUIContext} from '../packages/winui/src/javascript/context.js';
import {requestFacadeEvent} from '../packages/winui/src/javascript/event-requests.js';
import {subscribeFacadeEvent} from '../packages/winui/src/javascript/events.js';
import {propertyJavaScriptHost} from './helpers/a15-property-js-host.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function fixture(type = 'TextBox', requestOptions) {
  const value = propertyJavaScriptHost(), {context} = value;
  registerControlFamilyAdapters(context.registry);
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.' + type);
  const host = context.host;
  host.nodes = context.objects;
  host.options = {onEventRequest: (id, event, payload, options) => requestFacadeEvent(context, id, event, payload, options)};
  const requests = new HostEventRequests(host, requestOptions);
  host.requestEvent = (...args) => requests.request(...args);
  context.requestEvent = JavaScriptUIContext.prototype.requestEvent.bind(context);
  return {...value, owner, requests, host, dispose() {
    context.disposed = true;
    context.state(null, 'facadeEventRequests')?.dispose();
    requests.dispose();
    context.routedEventRouter.dispose();
  }};
}

test('JavaScript text decisions await promises in subscription order and return only the proposed-data outcome', async () => {
  const value = fixture(), {context, owner} = value;
  try {
    const gate = deferred(), calls = [], seen = [];
    owner.$values.Text = 'original';
    subscribeFacadeEvent(context, owner, 'BeforeTextChanging', async (sender, args) => {
      calls.push('first-start');
      seen.push(args);
      assert.equal(sender, owner);
      assert.equal(args.OriginalSource, owner);
      assert.equal(args.NewText, 'proposed');
      await gate.promise;
      args.Cancel = true;
      calls.push('first-end');
    });
    subscribeFacadeEvent(context, owner, 'BeforeTextChanging', (sender, args) => { calls.push('second'); seen.push(args); });
    context.options.onEvent = () => calls.push('observer');
    const result = context.requestEvent(owner, 'BeforeTextChanging', {NewText: 'proposed', Cancel: false});
    assert.deepEqual(calls, ['first-start']);
    assert.equal(owner.$values.Text, 'original');
    gate.resolve();
    const outcome = await result;
    assert.deepEqual(calls, ['first-start', 'first-end', 'second', 'observer']);
    assert.equal(seen[0], seen[1]);
    assert.equal(outcome.Cancel, true);
    assert.equal(outcome.NewText, 'proposed');
    assert.equal(owner.$values.Text, 'original');
    assert.equal(value.requests.pending.size, 0);
    assert.equal(context.state(null, 'facadeEventRequests').pending.size, 0);
  } finally { value.dispose(); }
});

test('JavaScript refresh and dialog callbacks hold actual deferrals until explicit completion', async () => {
  for (const [type, event] of [['RefreshContainer', 'RefreshRequested'], ['ContentDialog', 'PrimaryButtonClick']]) {
    const value = fixture(type), {context, owner} = value;
    try {
      let lease, eventArgs, complete = false;
      subscribeFacadeEvent(context, owner, event, (sender, args) => { eventArgs = args; lease = args.GetDeferral(); });
      const request = context.requestEvent(owner, event, {Cancel: false}).then(result => { complete = true; return result; });
      await tick();
      assert.equal(complete, false, type);
      assert.equal(context.state(null, 'facadeEventRequests').pending.size, 1);
      if (type === 'ContentDialog') eventArgs.Cancel = true;
      lease.Complete();
      const result = await request;
      assert.equal(result.Cancel, type === 'ContentDialog');
      assert.equal(complete, true);
      assert.throws(() => eventArgs.GetDeferral(), /no longer accepting/);
    } finally { value.dispose(); }
  }
});

test('JavaScript caller abort, node removal, restoration and disposal reject held decisions and suppress late routing', async () => {
  for (const action of ['abort', 'remove', 'restore', 'dispose']) {
    const value = fixture(), {context, owner} = value;
    const gate = deferred(), controller = new AbortController();
    let second = 0;
    try {
      subscribeFacadeEvent(context, owner, 'BeforeTextChanging', async () => { await gate.promise; });
      subscribeFacadeEvent(context, owner, 'BeforeTextChanging', () => { second++; });
      const result = context.requestEvent(owner, 'BeforeTextChanging', {NewText: 'proposed'}, {signal: controller.signal});
      const failed = assert.rejects(result, /superseded|removed|restored|ended|reset/);
      const service = context.state(null, 'facadeEventRequests');
      if (action === 'abort') controller.abort(new Error('superseded'));
      if (action === 'remove') { value.requests.cancelTarget(context.id(owner)); context.objects.delete(context.id(owner)); }
      if (action === 'restore') service.restore(service.snapshot());
      if (action === 'dispose') service.dispose();
      await failed;
      gate.resolve();
      await tick();
      assert.equal(second, 0, action);
      assert.equal(service.pending.size, 0);
      assert.equal(value.requests.pending.size, 0);
    } finally { value.dispose(); }
  }
});

test('JavaScript event errors and invalid targets fail explicitly within the existing host quota', async () => {
  const value = fixture('TextBox', {maximumPending: 1}), {context, owner} = value;
  try {
    await assert.rejects(context.requestEvent(owner, 'NotAnEvent'), /Unregistered/);
    await assert.rejects(context.requestEvent(owner, 'BeforeTextChanging', {data: new Date()}), /projection/);
    owner.$values.IsEnabled = false;
    await assert.rejects(context.requestEvent(owner, 'BeforeTextChanging'), /does not accept input/);
    owner.$values.IsEnabled = true;
    subscribeFacadeEvent(context, owner, 'BeforeTextChanging', async () => { throw new Error('callback failed'); });
    await assert.rejects(context.requestEvent(owner, 'BeforeTextChanging'), /callback failed/);
    context.state(owner, 'facadeEvents').dispose();
    const gate = deferred();
    subscribeFacadeEvent(context, owner, 'BeforeTextChanging', () => gate.promise);
    const first = context.requestEvent(owner, 'BeforeTextChanging');
    await assert.rejects(context.requestEvent(owner, 'BeforeTextChanging'), /Pending UI event request limit/);
    gate.resolve();
    await first;
  } finally { value.dispose(); }
});
