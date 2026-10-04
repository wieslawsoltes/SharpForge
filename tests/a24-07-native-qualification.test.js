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
  for (const id of ['global-json', 'nuget-config', 'gitignore-dotnet', 'gitattributes', 'central-packages',
    'dotnet-tools', 'launch-settings', 'appsettings', 'app-manifest']) {
    plan.records.push(...createItemPlan(id, { sdkVersion: version, projectName: 'ConfigHost', folder: id === 'launch-settings' ? 'ConfigHost' : '' }).records);
  }
  const project = plan.records.find(record => record.path.endsWith('.csproj'));
  project.text = project.text.replace('</PropertyGroup>', '  <ApplicationManifest>../app.manifest</ApplicationManifest>\n  </PropertyGroup>');
  await savePlan(directory, plan);
  assert.equal((await command(['--version'], directory)).stdout.trim(), version);
  assert.match((await command(['nuget', 'list', 'source', '--configfile', 'nuget.config'], directory)).stdout, /nuget.org/);
  await command(['tool', 'restore', '--tool-manifest', '.config/dotnet-tools.json'], directory);
  assert.match((await command(['sln', plan.entry, 'list'], directory)).stdout, /ConfigHost.*csproj/);
  await nativeBuild(directory, plan.entry);
  assert.match((await command(['msbuild', plan.startup, '-getProperty:ManagePackageVersionsCentrally'], directory)).stdout, /true/);
  assert.match((await command(['msbuild', plan.startup, '-getProperty:ApplicationManifest'], directory)).stdout, /app\.manifest/);
  assert.match((await command(['run', '--project', plan.startup, '--no-build', '--launch-profile', 'ConfigHost'], directory)).stdout, /Hello, world!/);
  await command(['init', '-q'], directory, 'git');
  await writeFile(join(directory, 'example.cs'), 'class Example {}\n');
  assert.match((await command(['check-ignore', 'bin/a.dll', 'obj/a.cs'], directory, 'git')).stdout, /bin\/a.dll/);
  assert.match((await command(['check-attr', 'diff', '--', 'example.cs'], directory, 'git')).stdout, /csharp/);
  assert.equal(JSON.parse(await readFile(join(directory, 'appsettings.json'), 'utf8')).AllowedHosts, '*');
  const reference = join(directory, 'web-reference');
  await command(['new', 'web', '--no-restore', '-o', reference], directory);
  const settings = JSON.parse(await readFile(join(directory, 'appsettings.json'), 'utf8'));
  const expected = JSON.parse(await readFile(join(reference, 'appsettings.json'), 'utf8'));
  assert.deepEqual(settings, expected);
  t.diagnostic(JSON.stringify({ target: 'native-dotnet', sdk: version, commands: ['dotnet', 'dotnet nuget', 'dotnet tool',
    'dotnet sln', 'NativeMSBuild', 'dotnet run', 'git check-ignore', 'git check-attr'], windowsManifest: 'Requires Windows qualification' }));
});

test('Generated observable model and RelayCommand execute property and command notifications on native .NET', { skip: disabled }, async t => {
  const directory = await nativeTemporary(t, 'sf-template-mvvm-');
  const plan = createProjectPlan('console', { projectName: 'MvvmHost', nullable: true });
  const model = createItemPlan('winui-mvvm-view-model', { name: 'MainViewModel.cs', namespace: 'MvvmHost', folder: 'MvvmHost' });
  plan.records.push(...model.records);
  plan.records.find(record => record.path.endsWith('/Program.cs')).text = [
    'using System; using MvvmHost;',
    'var model = new MainViewModel(); int changes = 0;',
    'model.PropertyChanged += (_, args) => { if (args.PropertyName != "DisplayName") throw new Exception("Property"); changes++; };',
    'model.DisplayName = "Ada"; model.DisplayName = "Ada";',
    'if (model.DisplayName != "Ada" || changes != 1) throw new Exception("Change detection");',
    'model.ResetCommand.Execute(null);',
    'if (model.DisplayName != "User" || changes != 2) throw new Exception("Reset");',
    'bool allowed = false; int runs = 0; int notifications = 0;',
    'var command = new RelayCommand(() => runs++, () => allowed);',
    'command.CanExecuteChanged += (_, _) => notifications++; command.Execute(null);',
    'if (runs != 0) throw new Exception("Disabled command");',
    'allowed = true; command.NotifyCanExecuteChanged(); command.Execute(null);',
    'if (runs != 1 || notifications != 1) throw new Exception("Enabled command");',
    'Console.WriteLine("Observable model and commands passed");', ''
  ].join('\n');
  await savePlan(directory, plan);
  await nativeBuild(directory, plan.entry);
  const result = await command(['run', '--project', plan.startup, '--no-build'], directory);
  assert.equal(result.stdout.trim(), 'Observable model and commands passed');
  t.diagnostic(JSON.stringify({ target: 'native-dotnet', model: 'INotifyPropertyChanged', command: 'ICommand',
    platform: process.platform, windowsXamlBindings: 'Requires separate Windows UI qualification' }));
});
