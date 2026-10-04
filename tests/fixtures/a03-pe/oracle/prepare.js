import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const output = process.argv[2];
if (!output) throw new Error('Pass an output directory');
mkdirSync(output, { recursive: true });
for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  for (const outputKind of ['console', 'library']) {
    const name = `${platform}-${outputKind}`;
    const source = outputKind === 'library' ? 'public class Library {}' : 'Console.WriteLine(42);';
    const compiled = compileToIL(source, { platform, name, outputKind: outputKind === 'console' ? 'exe' : outputKind });
    if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
    writeFileSync(join(output, `${name}.dll`), compiled.assembly);
  }
}
for (const platform of ['anycpu', 'x86', 'x64']) {
  const name = `desktop-${platform}`;
  const compiled = compileToIL('Console.WriteLine(42);', { platform, name, framework: 'mscorlib4' });
  if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
  writeFileSync(join(output, `${name}.exe`), compiled.assembly);
}
