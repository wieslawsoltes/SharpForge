import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectPlan, createItemPlan, projectTemplates, searchTemplates } from '@sharpforge/templates';
import { nativeEnabled, command, nativeTemporary, savePlan, nativeBuild } from './helpers/a24-native.js';

const disabled = nativeEnabled ? false : 'Set SHARPFORGE_TEMPLATE_NATIVE=1 for actual NativeMSBuild and dotnet execution';

for (const template of projectTemplates.filter(item => item.nativeCompatible)) {
  test('Native template builds and executes where applicable: ' + template.id, { skip: disabled }, async t => {
    const directory = await nativeTemporary(t, 'sf-template-native-');
    const plan = createProjectPlan(template.id, { projectName: 'Qualified', framework: 'net10.0' });
    await savePlan(directory, plan);
    await nativeBuild(directory, plan.entry);
    if (['console', 'console-async', 'test-console', 'console-library-solution'].includes(template.id)) {
      const result = await command(['run', '--project', plan.startup, '--no-build'], directory);
      assert.match(result.stdout, template.id === 'console-library-solution' ? /42/ : template.id === 'test-console' ? /All self-tests passed/ : /Hello/);
    }
    t.diagnostic(JSON.stringify({ template: template.id, target: 'native-dotnet', sdk: (await command(['--version'])).stdout.trim(),
      build: 'NativeMSBuild', platform: process.platform }));
  });
}

for (const id of ['xunit', 'nunit', 'mstest']) {
  test('Native test template restores, builds and runs passing tests: ' + id, { skip: disabled }, async t => {
    const directory = await nativeTemporary(t, 'sf-template-tests-');
    const plan = createProjectPlan(id, { projectName: 'QualifiedTests', framework: 'net10.0', nullable: true });
    const project = plan.records.find(record => record.path.endsWith('.csproj'));
    const item = createItemPlan(id + '-test-class', { name: 'AdditionalTests', folder: 'QualifiedTests', namespace: 'QualifiedTests',
      namespaceStyle: 'file-scoped', projectPath: project.path, projectText: project.text });
    project.text = item.modifications[0].text;
    plan.records.push(...item.records);
    await savePlan(directory, plan);
    await nativeBuild(directory, plan.entry);
    const result = await command(['test', plan.entry, '--no-restore', '--no-build', '--verbosity', 'normal'], directory);
    assert.match(result.stdout, /Passed:\s+2|Passed!.*2|Total tests:\s*2/);
    assert.doesNotMatch(result.stdout, /Failed:\s*[1-9]/);
    t.diagnostic(JSON.stringify({ template: id, target: 'native-dotnet', build: 'NativeMSBuild', runner: 'dotnet test', tests: 2,
      platform: process.platform }));
  });
}

test('All package-free core C# items compile together in a native console with file-scoped namespaces', { skip: disabled }, async t => {
  const directory = await nativeTemporary(t, 'sf-template-items-');
  const plan = createProjectPlan('console', { projectName: 'ItemHost', framework: 'net10.0' });
  const items = searchTemplates({ kind: 'item', category: 'Code', target: 'native-dotnet' });
  for (const template of items) {
    const item = createItemPlan(template.id, { namespace: 'ItemHost.Features', namespaceStyle: 'file-scoped', nullable: true, folder: 'ItemHost' });
    if (template.id === 'top-level-program') plan.records = plan.records.filter(record => !record.path.endsWith('/Program.cs'));
    else assert.match(item.records[0].text, /namespace ItemHost.Features;/);
    plan.records.push(...item.records);
  }
  await savePlan(directory, plan);
  await nativeBuild(directory, plan.entry);
  assert.equal((await command(['run', '--project', plan.startup, '--no-build'], directory)).stdout.trim(), 'Hello, World!');
  t.diagnostic(JSON.stringify({ target: 'native-dotnet', templates: items.map(item => item.id), build: 'NativeMSBuild', platform: process.platform }));
});

test('Generated configuration files are consumed by their native SDK and Git commands', { skip: disabled }, async t => {
  const directory = await nativeTemporary(t, 'sf-template-config-');
  const version = (await command(['--version'])).stdout.trim();
  const plan = createProjectPlan('console', { projectName: 'ConfigHost', solutionFormat: 'sln' });
  for (const id of ['global-json', 'nuget-config', 'gitignore-dotnet', 'gitattributes', 'central-packages', 'dotnet-tools', 'launch-settings', 'appsettings']) {
    plan.records.push(...createItemPlan(id, { sdkVersion: version, projectName: 'ConfigHost', folder: id === 'launch-settings' ? 'ConfigHost' : '' }).records);
  }
  await savePlan(directory, plan);
  assert.equal((await command(['--version'], directory)).stdout.trim(), version);
  assert.match((await command(['nuget', 'list', 'source', '--configfile', 'nuget.config'], directory)).stdout, /nuget.org/);
  await command(['tool', 'restore', '--tool-manifest', '.config/dotnet-tools.json'], directory);
  assert.match((await command(['sln', plan.entry, 'list'], directory)).stdout, /ConfigHost.*csproj/);
  await nativeBuild(directory, plan.entry);
  assert.match((await command(['msbuild', plan.startup, '-getProperty:ManagePackageVersionsCentrally'], directory)).stdout, /true/);
  assert.match((await command(['run', '--project', plan.startup, '--no-build', '--launch-profile', 'ConfigHost'], directory)).stdout, /Hello, world!/);
  await command(['init', '-q'], directory, 'git');
  await writeFile(join(directory, 'example.cs'), 'class Example {}\n');
  assert.match((await command(['check-ignore', 'bin/a.dll', 'obj/a.cs'], directory, 'git')).stdout, /bin\/a.dll/);
  assert.match((await command(['check-attr', 'diff', '--', 'example.cs'], directory, 'git')).stdout, /csharp/);
  assert.equal(JSON.parse(await readFile(join(directory, 'appsettings.json'), 'utf8')).AllowedHosts, '*');
  t.diagnostic(JSON.stringify({ target: 'native-dotnet', sdk: version, commands: ['dotnet', 'dotnet nuget', 'dotnet tool',
    'dotnet sln', 'NativeMSBuild', 'dotnet run', 'git check-ignore', 'git check-attr'], windowsManifest: 'Requires Windows qualification' }));
});
