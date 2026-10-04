import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const output = process.argv[2];
if (!output) throw new Error('Usage: node prepare.js OUTPUT_DIRECTORY');
mkdirSync(output, { recursive: true });
const cases = [
  { name: 'Default' },
  { name: 'English', assemblyVersion: '1.2.345.65535', assemblyCulture: 'en-US' },
  { name: 'Japanese', assemblyVersion: [3, 2, 1, 0], assemblyCulture: 'ja-JP' },
  { name: 'Maximum', assemblyVersion: [65535, 65535, 65535, 65535], assemblyCulture: 'neutral' },
  { name: 'Zero', assemblyVersion: [0, 0, 0, 0] },
];
for (const options of cases) {
  const result = compileToIL('public class Example {}', { outputKind: 'library', portablePdb: false, ...options });
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  writeFileSync(join(output, `${options.name}.dll`), result.assembly);
}
