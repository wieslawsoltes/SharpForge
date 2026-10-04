import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectPlan, createItemPlan, templateAvailability, getTemplate } from '@sharpforge/templates';
import { parseXml } from '@sharpforge/project-system';
import { nativeEnabled, command, nativeTemporary, savePlan, nativeBuild } from './helpers/a24-native.js';
import { windowsBuildProperties, windowsRuntimePlan, windowsExecutable } from './helpers/a24-windows-qualification.js';

const disabled = nativeEnabled && process.platform === 'win32' ? false :
  'Requires a Windows desktop session, Windows SDK and SHARPFORGE_TEMPLATE_NATIVE=1; generation checks do not qualify Windows execution';

test('WinUI test template emits an application-owned XAML UI thread and propagates runner results', () => {
  const plan = createProjectPlan('winui-native-tests', { projectName: 'UiTests', nullable: true });
  const record = name => plan.records.find(file => file.path === 'UiTests/' + name)?.text;
  for (const name of ['UiTests.csproj', 'App.xaml', 'MainWindow.xaml', 'app.manifest']) parseXml(record(name));
  assert.match(record('UiTests.csproj'), /<OutputType>Exe<\/OutputType>/);
  assert.match(record('UiTests.csproj'), /<EnableMSTestRunner>true<\/EnableMSTestRunner>/);
  assert.match(record('UiTests.csproj'), /<GenerateTestingPlatformEntryPoint>false<\/GenerateTestingPlatformEntryPoint>/);
  assert.match(record('App.xaml.cs'), /UITestMethodAttribute.DispatcherQueue = window.DispatcherQueue/);
  assert.match(record('App.xaml.cs'), /Environment.ExitCode = await runner.RunAsync\(\)/);
  assert.match(record('App.xaml.cs'), /finally\s*\{\s*window\?\.Close\(\);\s*Exit\(\)/);
  assert.match(record('UnitTest1.cs'), /\[UITestMethod\][\s\S]+new Grid\(\)/);
  assert.equal(plan.startup, 'UiTests/UiTests.csproj');
  assert.equal(templateAvailability(getTemplate('winui-native-tests'), { native: true, platform: 'linux' }).available, false);
  assert.throws(() => createProjectPlan('winui-native-tests', { framework: 'netstandard2.0' }), /Windows target/);
});

test('Native library and animation pages contain matching XAML partial classes and membership', () => {
  const library = createProjectPlan('winui-native-library', { projectName: 'Controls' });
  const control = library.records.find(record => record.path === 'Controls/SampleControl.xaml');
  assert.equal(parseXml(control.text).attributes['x:Class'], 'Controls.SampleControl');
  assert.match(library.records.find(record => record.path === control.path + '.cs').text, /partial class SampleControl : UserControl/);
  for (const id of ['winui-theme-transition', 'winui-visual-states']) {
    const plan = createItemPlan(id, { name: 'Example.xaml', namespace: 'Controls', projectPath: 'Host.csproj',
      projectText: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><UseWinUI>true</UseWinUI></PropertyGroup></Project>' });
    assert.equal(plan.records.length, 2);
    assert.equal(parseXml(plan.records[0].text).attributes['x:Class'], 'Controls.Example');
    assert.match(plan.records[1].text, /partial class Example : Page/);
    assert.match(plan.modifications[0].text, /<DependentUpon>Example.xaml<\/DependentUpon>/);
    assert.doesNotMatch(plan.records[0].text, /Storyboard.TargetProperty="(?:Width|Height|Background)"/);
  }
});

test('Windows runtime qualification composes real file plans and conflict-checked shared dictionaries', async () => {
  const plan = await windowsRuntimePlan();
  assert.equal(new Set(plan.records.map(record => record.path)).size, plan.records.length);
  const dictionary = plan.records.find(record => record.path === 'Themes/Generic.xaml');
  assert.deepEqual(parseXml(dictionary.text).children.map(node => node.attributes.TargetType), ['local:Badge', 'local:AlertBadge']);
  assert(plan.records.some(record => record.path === 'ShellSettings.xaml'));
  assert(plan.records.some(record => record.path === 'TemplateRuntimeChecks.cs'));
  assert.match(plan.records.find(record => record.path === 'Shell.xaml.cs').text, /public bool NavigateTo\(string destination\)/);
  assert.match(plan.records.find(record => record.path === 'GeneratedMarkup.cs').text, /Storyboard.TargetProperty=""Opacity""/);
  for (const record of plan.records.filter(record => /\.(xaml|manifest|csproj)$/.test(record.path))) parseXml(record.text);
});

for (const id of ['winui-native-unpackaged', 'winui-native-packaged', 'winui-native-library', 'winui-native-tests']) {
  test('Windows App SDK builds the generated native template: ' + id, { skip: disabled }, async t => {
    const directory = await nativeTemporary(t, 'sf-winui-template-');
    const plan = createProjectPlan(id, { projectName: 'QualifiedWinui', framework: 'net10.0', nullable: true });
    await savePlan(directory, plan);
    await nativeBuild(directory, plan.startup, { properties: windowsBuildProperties, timeoutMs: 120000 });
    if (id === 'winui-native-tests') {
      const executable = await windowsExecutable(directory, plan.startup);
      const result = await command([], directory, executable);
      assert.match(result.stdout, /Passed!/);
      assert.match(result.stdout, /(?:passed|succeeded):\s*2/i);
      const tests = join(directory, 'QualifiedWinui', 'UnitTest1.cs');
      const source = await readFile(tests, 'utf8');
      await writeFile(tests, source.replace('Assert.AreEqual(4, 2 + 2);', 'Assert.Fail("Expected qualification failure");'));
      await nativeBuild(directory, plan.startup, { restore: false, properties: windowsBuildProperties });
      await assert.rejects(() => command([], directory, executable), error =>
        Number.isInteger(error.code) && error.code > 0 && !error.killed &&
        /Expected qualification failure/.test((error.stdout ?? '') + (error.stderr ?? '')));
    }
    t.diagnostic(JSON.stringify({ template: id, target: 'windows-native', sdk: (await command(['--version'])).stdout.trim(),
      build: 'NativeMSBuild Windows App SDK', execution: id === 'winui-native-tests' ? 'MSTest app pass and intentional failure' : 'build' }));
  });
}

test('Windows generated controls render, bindings update UI and pages navigate in the actual XAML runtime', { skip: disabled }, async t => {
  const directory = await nativeTemporary(t, 'sf-winui-runtime-');
  const plan = await windowsRuntimePlan();
  await savePlan(directory, plan);
  await nativeBuild(directory, plan.entry, { properties: windowsBuildProperties, timeoutMs: 120000 });
  const executable = await windowsExecutable(directory, plan.entry);
  const output = join(directory, 'qualification.json');
  await command([], directory, executable, { env: { SHARPFORGE_TEMPLATE_RESULTS: output } });
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.engine, 'native Windows App SDK');
  assert.deepEqual(result.checks, [
    'native XAML pairs instantiate', 'default control styles render', 'resource dictionaries merge unique keys',
    'generated storyboards execute', 'generated transition and visual states execute',
    'generated MVVM bindings update UI', 'generated pages navigate and reject unknown routes'
  ]);
  t.diagnostic(JSON.stringify(result));
});
