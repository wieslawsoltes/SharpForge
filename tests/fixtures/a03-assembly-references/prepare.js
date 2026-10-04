import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const [output, net9Directory, net10Directory] = process.argv.slice(2);
if (!output || !net9Directory || !net10Directory) throw new Error('Usage: prepare.js OUTPUT NET9_REFERENCE_DIRECTORY NET10_REFERENCE_DIRECTORY');
mkdirSync(output, { recursive: true });
for (const [framework, directory] of [['net9', net9Directory], ['net10', net10Directory]]) {
  const referenceAssemblies = ['System.Runtime', 'System.Console'].map(name => new Uint8Array(readFileSync(join(directory, name + '.dll'))));
  const result = compileToIL('Console.WriteLine(42);', { framework, name: framework, portablePdb: false, referenceAssemblies });
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  writeFileSync(join(output, `${framework}.dll`), result.assembly);
}
