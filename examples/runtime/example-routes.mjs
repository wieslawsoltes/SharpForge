import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

/** Compile once and check the same expected trace in each independent JavaScript execution route. */
export function executeExample(source, expected, {compileOptions = {}, vmOptions = {}} = {}) {
  const compiled = compileToIL(source, {pipeline: 'bound', ...compileOptions});
  if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
  const routes = [
    ['source', () => new VirtualMachine(compiled.image, vmOptions)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly), vmOptions)],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly, vmOptions)]
  ];
  const observations = [];
  for (const [engine, create] of routes) {
    const vm = create();
    try {
      const result = vm.run();
      if (result.state !== 'terminated' || result.output !== expected) {
        throw new Error(engine + ': ' + JSON.stringify({state: result.state, fault: result.fault?.message, output: result.output}));
      }
      observations.push({engine, output: result.output, instructions: vm.instructions});
    } finally { vm.stop(); }
  }
  return observations;
}

export function runExampleIfMain(url, source, expected, options) {
  if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(url)) return;
  for (const result of executeExample(source, expected, options)) {
    process.stdout.write(result.engine + ':\n' + result.output);
  }
}
