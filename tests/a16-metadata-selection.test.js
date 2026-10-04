import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lockedMetadataSelection, selectPackageMetadataFiles, metadataSelectionProvenance }
  from '../packages/winui-controls/parity/metadata-selection.js';

const packageName = 'Microsoft.WindowsAppSDK.InteractiveExperiences';
const directory = path.resolve('fixture-packages', packageName.toLowerCase(), '1.8.260708001');
const identities = ['Microsoft.Foundation.winmd', 'Microsoft.Graphics.winmd', 'Microsoft.UI.winmd'];
const variant = version => identities.map(name => path.join(directory, 'metadata', version, name));
const license = path.join(directory, 'LICENSE');
const nuspec = path.join(directory, packageName + '.nuspec');
const files = [license, ...variant('10.0.17763.0'), nuspec, ...variant('10.0.18362.0')];
const lockFor = framework => ({ version: 1, dependencies: {
  [framework]: { 'Microsoft.WindowsAppSDK': { resolved: '1.8.260921001' } },
  [framework + '/win-x64']: { 'Microsoft.WindowsAppSDK.Foundation': { resolved: '1.8.260803002' } },
} });

test('A16 metadata importer selects the package MSBuild variant for the actual locked 19041 target', () => {
  const selection = lockedMetadataSelection(lockFor('net10.0-windows10.0.19041'));
  assert.equal(selection.targetPlatformVersion, '10.0.19041.0');
  assert.equal(selection.interactiveVersion, '10.0.18362.0');
  assert.deepEqual(selectPackageMetadataFiles(packageName, files, { directory, selection }),
    [license, nuspec, ...variant('10.0.18362.0')]);
  assert.deepEqual(metadataSelectionProvenance(packageName, selection), {
    targetPlatformVersion: '10.0.19041.0', directory: 'metadata/10.0.18362.0',
    ruleFile: 'build/Microsoft.InteractiveExperiences.Common.targets',
  });
});

test('A16 metadata variant boundary follows numeric Windows versions and never the runtime identifier', () => {
  for (const [target, expected] of [
    ['10.0.17763', '10.0.17763.0'], ['10.0.18361.65535', '10.0.17763.0'],
    ['10.0.18362', '10.0.18362.0'], ['10.0.18362.1', '10.0.18362.0'], ['10.0.26100', '10.0.18362.0'],
  ]) {
    const selection = lockedMetadataSelection(lockFor('net10.0-windows' + target));
    assert.equal(selection.interactiveVersion, expected);
    const chosen = selectPackageMetadataFiles(packageName, files, { directory, selection });
    assert.deepEqual(chosen.filter(file => file.endsWith('.winmd')), variant(expected));
  }
});

test('A16 metadata selection preserves unversioned packages and leaves source inputs intact', () => {
  const selection = lockedMetadataSelection(lockFor('net10.0-windows10.0.19041'));
  const original = [...files];
  const ordinary = [path.join(directory, 'metadata', 'Microsoft.UI.Xaml.winmd'), license];
  const result = selectPackageMetadataFiles('Microsoft.WindowsAppSDK.WinUI', ordinary, { directory, selection });
  assert.deepEqual(result, ordinary);
  assert.notEqual(result, ordinary);
  assert.equal(metadataSelectionProvenance('Microsoft.WindowsAppSDK.WinUI', selection), null);
  selectPackageMetadataFiles(packageName, Object.freeze(files), { directory, selection });
  assert.deepEqual(files, original);
});

test('A16 metadata selection rejects missing, ambiguous, and unspecified locked targets', () => {
  assert.throws(() => lockedMetadataSelection({ dependencies: {} }), /exactly one/);
  for (const framework of ['net10.0', 'net10.0-windows', 'net10.0-windows10.0', 'net10.0-windows10.0.70000']) {
    assert.throws(() => lockedMetadataSelection(lockFor(framework)), /explicit locked Windows|outside the supported/);
  }
  const first = lockFor('net10.0-windows10.0.19041');
  Object.assign(first.dependencies, lockFor('net10.0-windows10.0.26100').dependencies);
  assert.throws(() => lockedMetadataSelection(first), /exactly one/);
});

test('A16 metadata selection rejects missing selected files and unexpected package layouts instead of falling back', () => {
  const selection = lockedMetadataSelection(lockFor('net10.0-windows10.0.19041'));
  assert.throws(() => selectPackageMetadataFiles(packageName, variant('10.0.17763.0'), { directory, selection }), /Missing selected/);
  const incomplete = files.filter(file => file !== variant('10.0.18362.0')[2]);
  assert.throws(() => selectPackageMetadataFiles(packageName, incomplete, { directory, selection }), /microsoft.ui.winmd/);
  for (const unexpected of ['metadata/Microsoft.UI.winmd', 'metadata/10.0.26100.0/Microsoft.UI.winmd']) {
    assert.throws(() => selectPackageMetadataFiles(packageName, [...files, path.join(directory, unexpected)],
      { directory, selection }), /Unexpected locked/);
  }
});
