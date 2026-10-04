import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readNuGetPackage } from '../src/nuget/package-reader.js';

export async function verifyBuildOutputs(root, action, framework) {
  const directory = `App/bin/Debug/${framework}`;
  const paths = {
    restore: ['App/obj/project.assets.json'], build: [directory + '/App.dll', directory + '/App.pdb'],
    pack: ['App/bin/Debug/SharpForge.Qualification.1.0.0.nupkg'],
    publish: [directory + '/publish/App.dll', directory + '/publish/App.runtimeconfig.json', directory + '/publish/App.deps.json']
  }[action];
  if (!paths) throw new Error('Unknown qualification action');
  for (const path of paths) {
    const info = await lstat(join(root, path));
    if (!info.isFile() || !info.size) throw new Error('Expected nonempty artifact: ' + path);
  }
  if (action === 'pack') {
    const packageData = readNuGetPackage(new Uint8Array(await readFile(join(root, paths[0]))));
    if (packageData.metadata.id !== 'SharpForge.Qualification' || !packageData.files.some(file => file.path.endsWith('/App.dll'))) {
      throw new Error('NuGet package contents do not match fixture');
    }
  }
  return paths;
}

export function verifyExpectedFailure(result) {
  if (result.status !== 'failed' || !result.diagnostics.some(diagnostic => diagnostic.code === 'SFQA1001')) {
    throw new Error('Expected SFQA1001 native failure diagnostic');
  }
}
