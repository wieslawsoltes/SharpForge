import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine, instructionProfile, exportSpeedscope} from '@sharpforge/runtime';

const source = `class Program {
  static int A05BrowserTwice(int x) { return x * 2; }
  static int Main() { return A05BrowserTwice(20) + A05BrowserTwice(1); }
}`;

export function profileExports() {
  const artifact = compileToIL(source);
  if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
  const exports = [];
  for (const engine of ['source', 'reload', 'cil']) {
    const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly, {profile: true})
      : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), {profile: true});
    try {
      const result = vm.run();
      if (result.state !== 'terminated' || vm.returnValue !== 42) throw new Error(engine + ': invalid guest result');
      const recorded = instructionProfile(vm);
      const name = 'A05 browser ' + engine;
      const file = exportSpeedscope(recorded, {name});
      if (recorded.instructions !== vm.instructions || file.profiles[0].endValue !== vm.instructions) {
        throw new Error(engine + ': export total differs from actual executed instruction count');
      }
      const methods = recorded.methods.filter(method => method.instructions > 0).map(method => ({
        name: method.name, self: method.instructions, total: method.inclusiveInstructions
      }));
      if (!methods.some(method => method.name.includes('A05BrowserTwice')) || methods.length < 2) {
        throw new Error(engine + ': expected named guest methods missing');
      }
      if (methods.reduce((sum, method) => sum + method.self, 0) !== vm.instructions) {
        throw new Error(engine + ': self counts differ from VM instructions');
      }
      exports.push({engine, name, instructions: vm.instructions, methods, file, recorded});
    } finally { vm.stop(); }
  }
  return {passed: true, exports};
}
