import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeFacadeEvent, removeFacadeEvent, emitFacadeEvent, facadeRoutedEventArgs} from '../packages/winui/src/javascript/events.js';
import {propertyJavaScriptHost} from './helpers/a15-property-js-host.js';

test('A15 ordinary handlers and AddHandler routes preserve order, shared arguments and Handled', () => {
  const {context} = propertyJavaScriptHost();
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.Button');
  const order = [], argumentsSeen = [];
  const first = (sender, args) => { order.push(1); argumentsSeen.push(args); args.Handled = true; assert.equal(sender, owner); };
  subscribeFacadeEvent(context, owner, 'Click', first);
  context.routedEventRouter.addHandler(context.id(owner), 'Click', (id, payload) => {
    order.push(2); argumentsSeen.push(facadeRoutedEventArgs(context, payload));
  }, {handledEventsToo: true});
  subscribeFacadeEvent(context, owner, 'Click', (sender, args) => { order.push(3); argumentsSeen.push(args); });
  let complete = 0;
  context.options.onEvent = () => complete++;
  const args = emitFacadeEvent(context, owner, 'Click');
  assert.deepEqual(order, [1, 2]);
  assert.equal(argumentsSeen[0], argumentsSeen[1]);
  assert.equal(args, argumentsSeen[0]);
  assert.equal(args.OriginalSource, owner);
  assert.equal(args.Handled, true);
  assert.equal(complete, 1);
  removeFacadeEvent(context, owner, 'Click', first);
  order.length = 0;
  emitFacadeEvent(context, owner, 'Click');
  assert.deepEqual(order, [2, 3]);
});

test('A15 LostFocus updates a pending binding once before handlers and route completion', () => {
  const {context, lostFocus} = propertyJavaScriptHost();
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.TextBox');
  subscribeFacadeEvent(context, owner, 'LostFocus', () => assert.equal(lostFocus.length, 1));
  context.options.onEvent = () => assert.equal(lostFocus.length, 1);
  emitFacadeEvent(context, owner, 'LostFocus');
  assert.equal(lostFocus.length, 1);
});

test('A15 cancellation and drag response mutations reach the model synchronously once per route', () => {
  const {context} = propertyJavaScriptHost();
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.Button');
  const completed = [];
  context.services.drag = {completeEvent: (name, payload) => completed.push({name, payload})};
  subscribeFacadeEvent(context, owner, 'DragStarting', (sender, args) => { args.Cancel = true; });
  const payload = {Cancel: false};
  emitFacadeEvent(context, owner, 'DragStarting', payload);
  assert.equal(payload.Cancel, true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].payload.Cancel, true);
});

test('A15 ordinary event subscription rewind reattaches saved order without invoking handlers', () => {
  const {context} = propertyJavaScriptHost();
  const owner = context.allocate('Microsoft.UI.Xaml.Controls.Button');
  let first = 0, future = 0;
  const handler = () => first++;
  subscribeFacadeEvent(context, owner, 'Click', handler);
  const subscriptions = context.state(owner, 'facadeEvents'), snapshot = subscriptions.snapshot();
  removeFacadeEvent(context, owner, 'Click', handler);
  subscribeFacadeEvent(context, owner, 'Click', () => future++);
  subscriptions.restore(snapshot);
  assert.equal(first + future, 0);
  emitFacadeEvent(context, owner, 'Click');
  assert.equal(first, 1); assert.equal(future, 0);
  subscriptions.dispose();
  assert.equal(context.routedEventRouter.handlers.has(context.id(owner)), false);
});
