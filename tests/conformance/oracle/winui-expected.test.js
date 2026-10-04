import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWinuiExpectedFixture, validateWinuiExpectedResult } from '../../../scripts/conformance/oracle/winui-expected-fixtures.js';
import { pin } from '../../../scripts/conformance/oracle/toolchain.js';

// Synthetic contract samples only: these are never adopted or claimed as native observations.
function sample(fixture) {
  const thickness = { left: 1, top: 2, right: 3, bottom: 4 };
  const element = () => ({
    path: '0', type: 'Microsoft.UI.Xaml.FrameworkElement', name: 'Synthetic',
    layoutSlot: { x: 1.25, y: 2.5, width: 30.75, height: 40 },
    desiredSize: { width: 30.75, height: 40 }, actualSize: { width: 30.75, height: 40 },
    properties: {
      width: { value: 'NaN', hasLocalValue: false }, height: { value: 40, hasLocalValue: true },
      minWidth: 0, maxWidth: 'Infinity', minHeight: 0, maxHeight: 'Infinity',
      margin: thickness, visibility: 'Visible', horizontalAlignment: 'Stretch', verticalAlignment: 'Stretch',
      flowDirection: 'LeftToRight', opacity: 1, isHitTestVisible: true, actualTheme: 'Light',
    }, children: [{ path: '0/0', type: 'Synthetic.NonFrameworkElement', children: [] }],
  });
  return {
    schemaVersion: 1, inputHash: fixture.inputHash, runtime: pin.runtime, culture: 'en-US', theme: 'Light', winuiAssemblyVersion: '3.1.2.0',
    observations: fixture.input.fixtures.map(item => item.expected === 'load-error' ? {
      id: item.id, status: 'load-error', exception: 'System.Runtime.InteropServices.COMException', hresult: -2147467259,
    } : {
      id: item.id, status: 'loaded', viewport: item.viewport, rasterizationScale: 1.25, layout: element(),
      automation: [{ type: 'Synthetic.AutomationPeer', className: '', controlType: 'Custom', name: '', automationId: '',
        isEnabled: true, isContentElement: false, isControlElement: true, children: [] }],
    }),
  };
}

function rejectsMutation(fixture, mutate) {
  const result = sample(fixture); mutate(result);
  assert.throws(() => validateWinuiExpectedResult(fixture, result));
}

test('one WinUI expected fixture binds the complete current native input and preserves raw values', async () => {
  const fixture = await loadWinuiExpectedFixture();
  assert.equal(fixture.id, 'winui-measurements'); assert.equal(fixture.oracleId, 'winui');
  assert.equal(fixture.langVersion, null); assert.equal(fixture.input.fixtures.length, 20);
  assert.equal(fixture.inputHash, fixture.input.inputHash);
  const result = sample(fixture), before = JSON.stringify(result);
  assert.equal(validateWinuiExpectedResult(fixture, result), result);
  assert.equal(JSON.stringify(result), before);
  assert.equal(result.observations[0].rasterizationScale, 1.25);
  assert.equal(result.observations[0].layout.properties.width.value, 'NaN');
  assert.equal(result.observations.at(-1).hresult, -2147467259);
});

test('WinUI expected dump rejects incomplete, reordered, stale and unsupported observations', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    result => result.observations.pop(),
    result => result.observations.reverse(),
    result => { result.observations[1].id = result.observations[0].id; },
    result => { result.inputHash = '0'.repeat(64); },
    result => { result.runtime = '0.0.0'; },
    result => { result.culture = 'fr-FR'; },
    result => { result.theme = 'Dark'; },
    result => { result.winuiAssemblyVersion = ''; },
    result => { result.observations[0].status = 'unsupported'; },
    result => { result.observations[0].viewport = { width: 1, height: 1 }; },
    result => { result.observations[0].rasterizationScale = 0; },
    result => { result.extra = true; },
  ]) rejectsMutation(fixture, mutate);
});

test('WinUI expected dump rejects missing native fields, malformed numbers and unsigned HRESULTs', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    result => { delete result.observations[0].layout.actualSize; },
    result => { delete result.observations[0].layout.properties.width.hasLocalValue; },
    result => { result.observations[0].layout.properties.width.value = null; },
    result => { result.observations[0].layout.properties.opacity = '1'; },
    result => { result.observations[0].layout.properties.opacity = Infinity; },
    result => { result.observations[0].layout.properties.extra = 1; },
    result => { result.observations[0].layout.properties.isEnabled = { value: true, hasLocalValue: false }; },
    result => { delete result.observations[0].automation[0].isEnabled; },
    result => { result.observations.at(-1).hresult = 2147483648; },
    result => { result.observations.at(-1).hresult = -2147483649; },
    result => { result.observations.at(-1).exception = ''; },
  ]) rejectsMutation(fixture, mutate);
});

test('WinUI expected trees enforce native traversal bounds and retain empty native peer roots', async () => {
  const fixture = await loadWinuiExpectedFixture();
  for (const mutate of [
    result => { result.observations[0].layout.children[0].path = '0/2'; },
    result => { result.observations[0].layout.children = Array.from({ length: 2048 }, (_, index) => ({ path: '0/' + index, type: 'Synthetic', children: [] })); },
    result => { result.observations[0].automation = Array(2049).fill(result.observations[0].automation[0]); },
    result => {
      let parent = result.observations[0].layout;
      for (let depth = 1; depth <= 65; depth++) {
        const child = { path: parent.path + '/0', type: 'Synthetic', children: [] };
        parent.children = [child]; parent = child;
      }
    },
    result => {
      let parent = result.observations[0].automation[0];
      for (let depth = 1; depth <= 65; depth++) { const child = { ...parent, children: [] }; parent.children = [child]; parent = child; }
    },
  ]) rejectsMutation(fixture, mutate);
  const result = sample(fixture); result.observations[0].automation = [];
  assert.equal(validateWinuiExpectedResult(fixture, result), result);
});
