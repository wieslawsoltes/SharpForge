import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvironmentState, environmentLayoutProperties, validateEnvironmentSnapshot, inputPaneIntersection,
  TextScalePolicy, LayoutEngine, createLayoutRegistry } from '@sharpforge/winui-controls';

test('environment changes are atomic, deduplicated and separate text scaling from device pixels', () => {
  const state = new EnvironmentState(), observed = [];
  const unsubscribe = state.subscribe(event => observed.push(event));
  state.update({ RasterizationScale: 2, Size: { Width: 320, Height: 568 } });
  state.update({ RasterizationScale: 2 });
  state.update({ TextScaleFactor: 1.5 });
  assert.equal(observed.length, 2);
  assert.deepEqual(observed[0].changed, ['RasterizationScale', 'Size']);
  assert.equal(observed[0].current.TextScaleFactor, 1);
  assert.equal(state.TextScaleFactor, 1.5);
  assert.equal(state.RasterizationScale, 2);
  const copy = structuredClone(state.snapshot());
  assert.deepEqual(validateEnvironmentSnapshot(copy), state.snapshot());
  copy.Size.Width = 900;
  assert.equal(state.Size.Width, 320);
  unsubscribe();
  state.update({ HighContrast: true });
  assert.equal(observed.length, 2);
  state.dispose();
  assert.throws(() => state.update({ AnimationsEnabled: false }), /disposed/);
});

test('environment feedback rejects malformed coordinates, identities and unsupported fields', () => {
  const snapshot = new EnvironmentState().snapshot();
  for (const changes of [{ version: 2 }, { revision: -1 }, { RasterizationScale: 0 }, { RasterizationScale: 17 },
    { TextScaleFactor: NaN }, { TextScaleFactor: 9 }, { HighContrast: 1 }, { InputPaneOccludedRect: { X: 0, Y: 0, Width: -1, Height: 2 } },
    { Size: { Width: Infinity, Height: 1 } }, { RootId: 'x'.repeat(513) }, { unexpected: true }]) {
    assert.throws(() => validateEnvironmentSnapshot({ ...snapshot, ...changes }), /SFUI1670/);
  }
});

test('debugger environment restoration is silent and preserves subscriptions', () => {
  const state = new EnvironmentState(), before = state.snapshot(), observed = [];
  state.subscribe(change => observed.push(change));
  state.update({ HighContrast: true, AnimationsEnabled: false });
  state.restore(before);
  assert.equal(state.HighContrast, false);
  assert.equal(state.AnimationsEnabled, true);
  assert.equal(observed.length, 1);
  state.update({ TextScaleFactor: 2 });
  assert.equal(observed.length, 2);
});

test('keyboard occlusion clips actual client bounds into transformed host DIPs', () => {
  const root = { clientWidth: 320, clientHeight: 568,
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 650, bottom: 1156, width: 640, height: 1136 }) };
  assert.deepEqual(inputPaneIntersection(root, { x: 0, y: 820, width: 900, height: 500 }), { X: 0, Y: 400, Width: 320, Height: 168 });
  assert.deepEqual(inputPaneIntersection(root, undefined), { X: 0, Y: 0, Width: 0, Height: 0 });
  assert.deepEqual(inputPaneIntersection(root, { x: 800, y: 0, width: 50, height: 50 }), { X: 0, Y: 0, Width: 0, Height: 0 });
});

test('touch constraints enlarge input hit geometry without changing managed Width or Height', () => {
  const state = new EnvironmentState({ TouchMode: true });
  const node = { id: 'button', type: 'Microsoft.UI.Xaml.Controls.Button', properties: { Width: 24, Height: 24 } };
  const engine = new LayoutEngine({ registry: createLayoutRegistry(), measureProvider: { measure: () => ({ width: 0, height: 0 }) },
    resolveProperties: value => environmentLayoutProperties(value, state) });
  engine.synchronize(new Map([['button', node]]), ['button']);
  engine.updateLayout({ width: 320, height: 568 });
  assert.deepEqual(engine.states.get('button').renderSize, { width: 40, height: 40 });
  assert.deepEqual(node.properties, { Width: 24, Height: 24 });
  state.update({ TouchMode: false });
  engine.invalidate('button');
  engine.updateLayout({ width: 320, height: 568 });
  assert.deepEqual(engine.states.get('button').renderSize, { width: 24, height: 24 });
  engine.dispose();
});

test('text scale subscriptions stop cleanly and rejected values leave the current factor unchanged', () => {
  const values = [], policy = new TextScalePolicy();
  const unsubscribe = policy.subscribe(value => values.push(value));
  policy.setFactor(2);
  assert.throws(() => policy.setFactor(0), /between/);
  assert.equal(policy.factor, 2);
  unsubscribe();
  policy.setFactor(1);
  assert.deepEqual(values, [2]);
});
