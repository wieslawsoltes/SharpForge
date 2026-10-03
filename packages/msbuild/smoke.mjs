import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'msbuild:native-api', order: 1230, async run(context) {
    const {project} = context;
    const {normalizeBuildRequest}=await import('@sharpforge/msbuild');
    const {NativeWorkspace,NativeMSBuild}=await import('@sharpforge/msbuild/node');
    assert.equal(normalizeBuildRequest({project:'Demo.csproj'}).trusted,false);
    assert.equal(typeof NativeWorkspace.open,'function');
    assert.equal(typeof NativeMSBuild.prototype.start,'function');
  }},
];

export async function smokeInstalledCli({directory, packageRoot, run}) {
  const {join} = await import('node:path');
  const help = run(process.execPath, [join(packageRoot, 'bin', 'sharpforge-msbuild.js'), '--help'], {cwd: directory, encoding: 'utf8'});
  assert(help.includes('--trust-projects'), 'Installed MSBuild host help missing');
}
