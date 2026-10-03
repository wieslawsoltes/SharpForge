import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPlan, templateAvailability, getTemplate } from '@sharpforge/templates';
import { parseXml } from '@sharpforge/project-system';

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
