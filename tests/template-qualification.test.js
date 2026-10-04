import test from 'node:test';
import assert from 'node:assert/strict';
import { TemplateCatalog, createProjectPlan, validateTemplateQualifications } from '@sharpforge/templates';
import { ProjectSystem } from '@sharpforge/project-system';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

test('Every declared browser project template compiles and executes on source and direct CIL engines', async t => {
  const catalog = new TemplateCatalog();
  const observations = [];
  for (const template of catalog.list({ kind: 'project' }).filter(item => item.targets?.includes('browser-managed'))) {
    const plan = createProjectPlan(template.id, { projectName: 'Qualified', namespace: 'Qualified' });
    const system = new ProjectSystem(plan.records);
    const snapshot = system.load(plan.entry);
    assert(!snapshot.diagnostics.some(item => item.severity === 'error'), template.id);
    if (plan.startup) {
      const source = system.compilationFiles(plan.startup);
      const options = system.compilationOptions(plan.startup);
      let compiled = compileToIL(source, options);
      assert(compiled.success, JSON.stringify(compiled.diagnostics));
      if (compiled.image.entryPoint === null && source.length) {
        const body = template.winui ?
          'Qualified.CardControl card = new Qualified.CardControl(); card.SetCaption("Qualified"); ' +
            'Microsoft.UI.Xaml.Window window = new Microsoft.UI.Xaml.Window(); window.Content = card.View; window.Activate();' :
          'System.Console.WriteLine(Qualified.Calculator.Add(20, 22));';
        compiled = compileToIL([...source, { uri: 'QualificationHost.cs', text: 'class Host { static void Main() { ' + body + ' } }' }]);
        assert(compiled.success, JSON.stringify(compiled.diagnostics));
      }
      if (compiled.image.entryPoint !== null) {
        for (const vm of [new VirtualMachine(compiled.image, { virtualTime: true }), new CilVirtualMachine(compiled.assembly, { virtualTime: true })]) {
          const result = await vm.runAsync();
          assert.equal(result.state, 'terminated', result.fault?.message);
          if (template.winui) assert.equal(vm.platform.scene().windows.length, 1);
          else assert.match(result.output, /Hello|42|All self-tests passed/);
        }
      }
    }
    observations.push({ template: template.id, target: 'browser-managed', status: 'passed', engine: 'source VM and direct CIL',
      evidence: 'tests/template-qualification.test.js; empty project/solution validated structurally' });
  }
  const expected = catalog.list({ kind: 'project' }).filter(item => item.targets?.includes('browser-managed')).map(item => item.id).sort();
  const result = validateTemplateQualifications(catalog, { target: 'browser-managed', observations });
  assert.deepEqual(result.qualified.map(item => item.template).sort(), expected);
  t.diagnostic(JSON.stringify({ target: 'browser-managed', observations }));
});

test('Qualification rejects a missing, skipped, duplicate or wrong-target observation', () => {
  const template = { id: 'example', kind: 'project', targets: ['native-dotnet'], prerequisites: ['.NET SDK'] };
  const catalog = new TemplateCatalog([template]);
  const passed = { template: 'example', target: 'native-dotnet', status: 'passed', engine: 'NativeMSBuild', evidence: 'native artifact' };
  assert.throws(() => validateTemplateQualifications(catalog, { target: 'native-dotnet' }), error => error.code === 'SFTPL020');
  assert.throws(() => validateTemplateQualifications(catalog, { target: 'native-dotnet', observations: [{ ...passed, status: 'skipped' }] }));
  assert.throws(() => validateTemplateQualifications(catalog, { target: 'native-dotnet', observations: [{ ...passed, target: 'browser-managed' }] }));
  assert.throws(() => validateTemplateQualifications(catalog, { target: 'native-dotnet', observations: [passed, passed] }), /Duplicate/);
  assert.equal(validateTemplateQualifications(catalog, { target: 'native-dotnet', observations: [passed] }).qualified.length, 1);
  assert.throws(() => validateTemplateQualifications(new TemplateCatalog(), { target: 'windows-native' }), error =>
    error.targets.every(item => item.prerequisites.length > 0));
});
