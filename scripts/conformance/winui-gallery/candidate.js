import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { directory } from './catalog.js';

/** Execute the real public source/CIL engine and read its retained control property state. */
export async function runCandidate(fixture, engine) {
  if (!['source', 'cil'].includes(engine)) throw new Error(`Unknown Gallery engine: ${engine}`);
  if (!fixture.source) return { status: 'unsupported', reason: 'No public XAML loading adapter on this engine.' };
  const source = await readFile(path.join(directory, fixture.source), 'utf8');
  const compiled = compileToIL(source);
  if (!compiled.success) return { status: 'unsupported', reason: 'Fixture compilation failed', diagnostics: compiled.diagnostics };
  const vm = engine === 'source' ? new VirtualMachine(compiled.image, { virtualTime: true, maxInstructions: 100000 }) :
    new CilVirtualMachine(compiled.assembly, { virtualTime: true, maxInstructions: 100000 });
  try {
    const result = await vm.runAsync();
    if (result.state !== 'terminated') {
      return { status: 'observed', observation: { rejected: true, exception: result.fault?.message ?? result.state } };
    }
    const node = vm.platform.scene().nodes.find(item => item.properties.Name === 'fixture');
    if (!node) throw new Error(`Gallery fixture did not create its control: ${fixture.id}`);
    const properties = Object.fromEntries(fixture.properties.map(key => [key, node.properties[key]]));
    return { status: 'observed', observation: { rejected: false, properties } };
  } finally { vm.stop(); }
}
