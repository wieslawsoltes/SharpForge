import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {asyncNativeTimeout, selectAsyncToolchain} from './support/cil-async-toolchain.js';

test('async native fixtures select the exact SDK inventory root and one shared supported language', () => {
  const sdkRoot = join('installation with spaces', 'sdk');
  const inventory = `8.0.425 [${sdkRoot}]\r\n10.0.201 [${sdkRoot}]\r\n`;
  for (const [sdk, framework] of [['8.0.425', 'net8.0'], ['10.0.201', 'net10.0']]) {
    const selected = selectAsyncToolchain({sdk, inventory, framework});
    assert.equal(selected.available, true);
    assert.equal(selected.compiler, join(sdkRoot, sdk, 'Roslyn', 'bincore', 'csc.dll'));
    assert.equal(selected.dotnetRoot, 'installation with spaces');
    assert.equal(selected.framework, framework);
    assert.equal(selected.languageVersion, '12');
    assert.deepEqual(selected.runtimeConfig, {runtimeOptions: {tfm: framework,
      framework: {name: 'Microsoft.NETCore.App', version: framework.slice(3) + '.0'}}});
  }
  assert.equal(asyncNativeTimeout, 30_000);
});

test('missing prerequisite is explicit while mismatched or ambiguous installed SDK axes fail', () => {
  assert.equal(selectAsyncToolchain({sdk: null, inventory: ''}).available, false);
  assert.match(selectAsyncToolchain({sdk: '7.0.410', inventory: ''}).reason, /C# 12.*SDK 8/);
  assert.throws(() => selectAsyncToolchain({sdk: '8.0.425', inventory: '8.0.425 [sdk]', framework: 'net10.0'}), /does not match/);
  assert.throws(() => selectAsyncToolchain({sdk: '8.0.425', inventory: '10.0.201 [sdk]'}), /one exact/);
  assert.throws(() => selectAsyncToolchain({sdk: '8.0.425', inventory: '8.0.425 [one]\n8.0.425 [two]'}), /one exact/);
  assert.throws(() => selectAsyncToolchain({sdk: '../sdk', inventory: ''}), /Invalid selected/);
});
