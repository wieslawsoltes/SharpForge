import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemPlan, createProjectPlan, mergeResourceDictionary } from '@sharpforge/templates';
import { parseXml } from '@sharpforge/project-system';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const pairs = ['page', 'window', 'user-control', 'content-dialog'];
for (const type of pairs) test('Native XAML ' + type + ': code-behind and DependentUpon agree', () => {
  const project = createProjectPlan('winui-native-library', { projectName: 'Views' });
  const xml = project.records.find(record => record.path.endsWith('.csproj'));
  const plan = createItemPlan('winui-xaml-' + type, { name: 'Sample.xaml', namespace: 'Views',
    folder: 'Views', projectPath: xml.path, projectText: xml.text });
  assert.equal(plan.records.length, 2);
  const root = parseXml(plan.records[0].text);
  assert.equal(root.attributes['x:Class'], 'Views.Sample');
  assert(plan.records[1].text.includes('partial class Sample : ' + root.name));
  assert(plan.modifications[0].text.includes('<DependentUpon>Sample.xaml</DependentUpon>'));
  assert(plan.warnings.some(warning => warning.includes('XAML compiler')));
});

test('Native templated controls merge Generic.xaml without duplicate resource keys', () => {
  const first = createItemPlan('winui-templated-control', { name: 'First.cs' });
  const second = createItemPlan('winui-templated-control', { name: 'Second.cs', existing: first.records });
  assert.equal(second.modifications.length, 1);
  assert(second.modifications[0].text.includes('local:First'));
  assert(second.modifications[0].text.includes('local:Second'));
  assert.throws(() => mergeResourceDictionary('<ResourceDictionary><Style x:Key="Existing" /></ResourceDictionary>', '<Style />', 'Existing'), /Duplicate/);
  for (const id of ['winui-resource-dictionary', 'winui-style', 'winui-control-template', 'winui-data-template',
    'winui-storyboard-xaml', 'winui-theme-transition', 'winui-visual-states']) parseXml(createItemPlan(id).records[0].text);
});

test('Portable generated storyboard runs on source and direct CIL engines', () => {
  const plan = createItemPlan('winui-storyboard-code', { name: 'Fade.cs', namespace: 'Example' });
  const compiled = compileToIL([...plan.records.map(record => ({ uri: record.path, text: record.text })), {
    uri: 'Program.cs', text: 'using Example; using Microsoft.UI.Xaml.Controls; class Program { static void Main() {' +
      'Button button = new Button(); var animation = Fade.Create(button); animation.Begin(); ' +
      'SharpForge.UI.AnimationClock.AdvanceBy(100); Console.WriteLine(button.Opacity); animation.Stop(); } }'
  }]);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '0.5\n');
  }
});

test('Native MVVM shell wires observable settings, RelayCommand and two navigation pages', () => {
  const plan = createItemPlan('winui-mvvm-shell', { name: 'Shell.xaml', namespace: 'Example' });
  assert(plan.records.find(record => record.path === 'Shell.xaml').text.includes('ItemInvoked="Navigate"'));
  assert(plan.records.find(record => record.path === 'Shell.xaml.cs').text.includes('typeof(ShellSettings)'));
  assert(plan.records.find(record => record.path === 'ShellSettings.xaml').text.includes('Model.DisplayName, Mode=TwoWay'));
  assert(plan.records.find(record => record.path === 'ShellViewModel.cs').text.includes('INotifyPropertyChanged'));
  assert(plan.records.find(record => record.path === 'RelayCommand.cs').text.includes('CanExecuteChanged'));
  for (const record of plan.records.filter(record => record.path.endsWith('.xaml'))) parseXml(record.text);
  assert.throws(() => createItemPlan('winui-xaml-page', { name: '../Bad.xaml' }));
});
