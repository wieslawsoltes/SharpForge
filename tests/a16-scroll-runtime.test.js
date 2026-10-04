import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeBrowserScroll, observeManagedScroll } from '../packages/runtime/src/ui/layout-scroll-services.js';

function fixture(browser = true) {
  const commands = [], outputs = [];
  const node = { id: 'scroll', properties: {} };
  const state = { node, data: {} };
  const service = { context: { platform: { options: browser ? { uiHostRequest() {} } : {} } }, nextScrollCorrelationId: 1,
    notify: (...args) => commands.push(args), identity: receiver => receiver,
    engine: { states: new Map([['scroll', state]]) }, setOutput(id, property, value) {
      outputs.push([id, property, value]);
      node.properties[property] = value;
    } };
  return { service, commands, outputs, state };
}

test('worker scroll calls retain browser completion ownership and exactly one correlation id', () => {
  const { service, commands, outputs } = fixture();
  assert.deepEqual(invokeBrowserScroll(service, 'scroll', 'ScrollTo', [0, 200, { AnimationMode: 0 }]), { value: 1 });
  assert.deepEqual(invokeBrowserScroll(service, 'scroll', 'ZoomTo', [2, null]), { value: 2 });
  assert.deepEqual(commands, [['scroll', 'ScrollTo', [0, 200, { AnimationMode: 0 }], { correlationId: 1 }],
    ['scroll', 'ZoomTo', [2, null], { correlationId: 2 }]]);
  assert.deepEqual(outputs, []);
  assert.deepEqual(invokeBrowserScroll(service, 'scroll', 'ChangeView', [null, 20, null, true]), { value: true });
  assert.equal(invokeBrowserScroll(service, 'scroll', 'Measure', []), null);
  assert.equal(invokeBrowserScroll(fixture(false).service, 'scroll', 'ScrollTo', [0, 200]), null);
});

test('browser viewport feedback updates managed read-only metrics before callbacks', () => {
  const { service, state } = fixture();
  observeManagedScroll(service, 'scroll', 'ViewChanged', { HorizontalOffset: 10, VerticalOffset: 20, ZoomFactor: 2,
    ExtentWidth: 1000, ExtentHeight: 500, ViewportWidth: 200, ViewportHeight: 100 });
  assert.equal(state.node.properties.ScrollableWidth, 900);
  assert.equal(state.node.properties.ScrollableHeight, 450);
  assert.equal(state.data.scroll.verticalOffset, 20);
  assert.throws(() => observeManagedScroll(service, 'scroll', 'ViewChanged', { ZoomFactor: 0 }), /Invalid browser scroll/);
});

test('worker scroll rejects nonfinite values, invalid modes, centers and exhausted correlation ids', () => {
  const { service } = fixture();
  assert.throws(() => invokeBrowserScroll(service, 'scroll', 'ScrollTo', [Infinity, 0]), /Invalid scroll coordinate/);
  assert.throws(() => invokeBrowserScroll(service, 'scroll', 'ZoomTo', [1, { X: 0, Y: NaN }]), /Invalid zoom center/);
  assert.throws(() => invokeBrowserScroll(service, 'scroll', 'ScrollBy', [0, 1, { SnapPointsMode: 99 }]), /Invalid scrolling option/);
  assert.throws(() => invokeBrowserScroll(service, 'scroll', 'ChangeView', [0, 0, 1, 1]), /Invalid animation flag/);
  service.nextScrollCorrelationId = 2147483648;
  assert.throws(() => invokeBrowserScroll(service, 'scroll', 'ScrollTo', [0, 1]), /correlation id exhausted/);
});
