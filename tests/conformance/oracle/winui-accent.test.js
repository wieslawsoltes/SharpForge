import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {envelope, expectedPath, validateSchema} from '../../../scripts/conformance/oracle/store.js';
import {winuiInput} from '../../../scripts/conformance/oracle/winui-run.js';
import {oracleRoot, pin, sha256} from '../../../scripts/conformance/oracle/toolchain.js';

const keys = ['SystemAccentColor', 'SystemAccentColorLight1', 'SystemAccentColorLight2',
  'SystemAccentColorLight3', 'SystemAccentColorDark1', 'SystemAccentColorDark2', 'SystemAccentColorDark3'];

// Synthetic schema data only. These values are never written as a native oracle or reference ramp.
function schemaExample() {
  return {
    schemaVersion: 1,
    source: 'Windows.UI.ViewManagement.UISettings.GetColorValue',
    colors: Object.fromEntries(keys.map((key, index) => [key, '#FF00000' + index])),
    environment: {osVersion: '10.0.19041.0', osArchitecture: 'X64', processArchitecture: 'X64',
      runtimeVersion: pin.runtime, winuiAssembly: 'Synthetic schema example', applicationTheme: 'Light', highContrast: false}
  };
}

function schemaEntry(accentPalette = schemaExample()) {
  return {...envelope('winui', {id: 'winui-controls-dispatcher', inputHash: 'a'.repeat(64)}, {
    content: 'schema example', dependencyPropertyCleared: true, zeroWidth: true,
    negativeWidthException: 'System.ArgumentException', malformedXamlException: 'System.Exception',
    childrenRemoved: true, dispatcherThreadAccess: true, dispatcherOrder: [1, 2],
    cancelledWorkRan: false, windowClosed: true, accentPalette
  }), target: 'win32-x64'};
}

test('native accent schema requires seven actual-color slots, source and bounded environment metadata', () => {
  const entry = schemaEntry();
  assert.equal(validateSchema(entry), true);
  assert.match(expectedPath(entry), /win32-x64/);
  for (const key of keys) {
    const missing = schemaEntry();
    delete missing.result.accentPalette.colors[key];
    assert.throws(() => validateSchema(missing));
  }
  for (const color of ['#123456', '#GG000000', '#FFFFFFFFF', 'Canvas', 1, null]) {
    const malformed = schemaEntry();
    malformed.result.accentPalette.colors.SystemAccentColor = color;
    assert.throws(() => validateSchema(malformed));
  }
  const extra = schemaEntry();
  extra.result.accentPalette.colors.SystemAccentColorInvented = '#FF000000';
  assert.throws(() => validateSchema(extra));
  const absent = schemaEntry();
  delete absent.result.accentPalette;
  assert.throws(() => validateSchema(absent));
});

test('native accent observations reject missing provenance and unsupported environment shapes', () => {
  for (const field of ['source', 'environment']) {
    const entry = schemaEntry();
    delete entry.result.accentPalette[field];
    assert.throws(() => validateSchema(entry));
  }
  for (const [field, value] of [['osVersion', '../host'], ['processArchitecture', 'AnyCPU'],
    ['runtimeVersion', 'unknown'], ['winuiAssembly', 'a'.repeat(513)], ['applicationTheme', 'Default'], ['highContrast', 1]]) {
    const entry = schemaEntry();
    entry.result.accentPalette.environment[field] = value;
    assert.throws(() => validateSchema(entry));
  }
  const generated = schemaEntry();
  generated.result.accentPalette.source = 'generated-browser-fallback';
  assert.throws(() => validateSchema(generated));
});

test('native accent helper bytes participate in the existing pinned WinUI fixture identity', async () => {
  const fixture = await winuiInput();
  const helper = fixture.files.find(file => file.name === 'AccentPalette.cs');
  assert(helper, 'the native capture helper is part of the input hash');
  assert.equal(helper.sha256, sha256(await readFile(path.join(oracleRoot, 'WinUI/AccentPalette.cs'))));
  assert.equal(fixture.inputHash, sha256(JSON.stringify(fixture.files)));
});
