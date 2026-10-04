import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const output = process.argv[2];
if (!output) throw new Error('Usage: node prepare.js OUTPUT_DIRECTORY');
mkdirSync(output, { recursive: true });
const keys = JSON.parse(readFileSync(new URL('../clr-identity/public-keys.json', import.meta.url), 'utf8'));
const publicKey = new Uint8Array(Buffer.from(keys.cases[1].key, 'hex'));
for (const mode of ['publicSign', 'delaySign']) {
  for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
    const result = compileToIL('public class Program { public static int Value() { return 42; } }',
      { outputKind: 'library', name: 'PublicSignFixture', publicKey, [mode]: true, platform });
    if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
    writeFileSync(join(output, `${mode}-${platform}.dll`), result.assembly);
  }
}
