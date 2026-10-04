import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const output = process.argv[2];
if (!output) throw new Error('Usage: prepare.js OUTPUT_DIRECTORY');
mkdirSync(output, { recursive: true });
for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  const result = compileToIL('public class Part { public static int Value() { return 42; } }',
    { outputKind: 'netmodule', name: 'Part', platform });
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  writeFileSync(join(output, `${platform}.netmodule`), result.assembly);
}
