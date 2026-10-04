import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { CilVirtualMachine, VirtualMachine } from '@sharpforge/runtime';
import { evaluate, propertyProject, noErrors } from './helpers/project-evaluation.js';

test('B04 evaluated Debug/Release symbols actually reach compiler preprocessing and execution', () => {
  const source = '#if DEBUG\nConsole.WriteLine("debug");\n#else\nConsole.WriteLine("release");\n#endif';
  for (const configuration of ['Debug', 'Release']) {
    const result = evaluate(propertyProject({ OutputType: 'Exe', Nullable: 'enable', AllowUnsafeBlocks: 'true', NoWarn: '0168',
      WarningsAsErrors: '0219', TreatWarningsAsErrors: 'true' }, '', 'Sdk="Microsoft.NET.Sdk"'),
    { 'App/Program.cs': source }, { configuration });
    noErrors(result);
    const options = result.system.compilationOptions('App/App.csproj');
    assert.equal(options.preprocessorSymbols.includes('DEBUG'), configuration === 'Debug');
    assert.equal(options.nullableContext, 'enable');
    assert.equal(options.allowUnsafe, true);
    assert.deepEqual(options.noWarn, ['0168', '1701', '1702']);
    assert.deepEqual(options.warnAsError, ['0219']);
    const compiled = compileToIL(result.system.compilationFiles('App/App.csproj'), options);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    for (const machine of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
      assert.equal(machine.run().output, configuration.toLowerCase() + '\n');
    }
  }
});

test('implicit usings compile Console and List without user using declarations on both browser engines', () => {
  const result = evaluate(propertyProject({ TargetFramework: 'net10.0', OutputType: 'Exe', ImplicitUsings: 'enable',
    GenerateAssemblyInfo: 'false' }, '', 'Sdk="Microsoft.NET.Sdk"'), {
    'App/Program.cs': 'var values = new List<int>(); values.Add(42); Console.WriteLine(values[0]);',
  });
  noErrors(result);
  const compiled = compileToIL(result.system.compilationFiles(), result.system.compilationOptions());
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const machine of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    assert.equal(machine.run().output, '42\n');
  }
});
