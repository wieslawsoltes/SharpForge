import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installTemplatePackage, instantiateTemplate, evaluateTemplateSymbols, TemplateCatalog } from '@sharpforge/templates';
import { nativeEnabled, command, nativeTemporary, diskRecords, savePlan, nativeBuild } from './helpers/a24-native.js';

async function sdkTemplates() {
  assert(process.env.DOTNET_ROOT, 'Set DOTNET_ROOT to locate the actual SDK template package');
  const version = (await command(['--version'])).stdout.trim();
  const root = join(process.env.DOTNET_ROOT, 'templates');
  for (const folder of (await readdir(root)).sort().reverse()) {
    const packageName = (await readdir(join(root, folder)))
      .find(name => name.startsWith('microsoft.dotnet.common.projecttemplates.') && name.endsWith(version + '.nupkg'));
    if (!packageName) continue;
    const { catalog } = installTemplatePackage(new Uint8Array(await readFile(join(root, folder, packageName))), { catalog: new TemplateCatalog([]) });
    return { version, catalog, packageName };
  }
  throw new Error('No common project template package matches SDK ' + version);
}

const disabled = nativeEnabled ? false : 'Set SHARPFORGE_TEMPLATE_NATIVE=1 and DOTNET_ROOT for real SDK parity';

test('SDK console and classlib configurations expose actual typed defaults and bindings', { skip: disabled }, async t => {
  const { version, catalog, packageName } = await sdkTemplates();
  for (const shortName of ['console', 'classlib']) {
    const template = catalog.list({ kind: 'all' }).find(item => item.language === 'C#' && item.config.shortNames.includes(shortName));
    assert(template, shortName);
    const values = evaluateTemplateSymbols(template.config);
    assert.equal(values.Framework, 'net' + version.split('.')[0] + '.0');
    assert.equal(values.skipRestore, false);
    assert.equal(values.langVersion, '');
    assert.equal(values.HostIdentifier, 'dotnetcli');
    assert.equal(values.csharp10orLater, true);
    assert.equal(template.config.parameters.find(item => item.name === 'Framework').dataType, 'choice');
    assert.equal(template.config.parameters.find(item => item.name === 'skipRestore').dataType, 'bool');
    assert.throws(() => evaluateTemplateSymbols(template.config, { Framework: 'net999.0' }), /Invalid choice/);
  }
  t.diagnostic(JSON.stringify({ reference: 'Microsoft .NET SDK', version, packageName, targets: ['console', 'classlib'] }));
});

for (const scenario of [
  { name: 'ConsoleDefault', shortName: 'console', parameters: {}, args: [] },
  { name: 'ConsoleMain', shortName: 'console', parameters: { UseProgramMain: true }, args: ['--use-program-main'] },
  { name: 'ConsoleOldLanguage', shortName: 'console', parameters: { UseProgramMain: true, langVersion: '7.3' },
    args: ['--use-program-main', '--langVersion', '7.3'] },
  { name: 'LibraryDefault', shortName: 'classlib', parameters: {}, args: [] },
  { name: 'Console-Hyphen', shortName: 'console', parameters: { UseProgramMain: true }, args: ['--use-program-main'] }
]) {
  test('SDK template byte parity and NativeMSBuild: ' + scenario.name, { skip: disabled }, async t => {
    const { version, catalog } = await sdkTemplates();
    const template = catalog.list({ kind: 'all' }).find(item => item.language === 'C#' && item.config.shortNames.includes(scenario.shortName));
    const directory = await nativeTemporary(t, 'sf-template-parity-');
    await writeFile(join(directory, 'global.json'), JSON.stringify({ sdk: { version, rollForward: 'disable' } }));
    const reference = join(directory, 'reference');
    await command(['new', scenario.shortName, '-n', scenario.name, '-o', reference, '--no-restore', ...scenario.args], directory);
    const plan = instantiateTemplate(template.config, template.files, { name: scenario.name, parameters: { skipRestore: true, ...scenario.parameters } });
    const expected = await diskRecords(reference);
    assert.deepEqual(plan.records.map(record => record.path), expected.map(record => record.path));
    for (const record of expected) assert.deepEqual(plan.records.find(item => item.path === record.path).bytes, record.bytes, record.path);
    assert.equal(plan.postActions.some(action => action.kind === 'restore'), false);
    const generated = join(directory, 'generated');
    await mkdir(generated);
    await savePlan(generated, plan);
    await nativeBuild(generated, scenario.name + '.csproj');
    if (scenario.shortName === 'console') {
      const output = await command(['run', '--project', scenario.name + '.csproj', '--no-build'], generated);
      assert.equal(output.stdout.trim(), 'Hello, World!');
    }
    t.diagnostic(JSON.stringify({ reference: 'dotnet new', sdk: version, scenario: scenario.name, byteIdentical: true,
      build: 'NativeMSBuild', platform: process.platform }));
  });
}
