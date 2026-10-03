import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node prepare.js OUTPUT_DIRECTORY');
await mkdir(directory, { recursive: true });
for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  const result = compileToIL('public class ResourceContainer {}', {
    name: `ResourceFixture_${platform}`, outputKind: 'library', platform, portablePdb: false,
    managedResources: [
      { name: 'public.binary', bytes: Uint8Array.from({ length: 256 }, (_, index) => index) },
      { name: 'private.空', bytes: new TextEncoder().encode('embedded\0resource'), visibility: 'private' },
      { name: 'empty', bytes: new Uint8Array() },
    ],
  });
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  await writeFile(join(directory, `${platform}.dll`), result.assembly);
}
