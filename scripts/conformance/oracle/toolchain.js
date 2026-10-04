import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { runProcess } from './process.js';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const oracleRoot = path.join(root, 'tests/conformance/oracle');
export const platform = `${process.platform}-${process.arch}`;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
export const pin = await readJSON(path.join(root, 'planning/qualification/oracle-toolchain.json'));

export function assertPins(actual, expected = pin, target = platform) {
  for (const key of ['sdk', 'runtime', 'referencePack']) {
    if (actual[key] !== expected[key]) throw new Error(`Oracle ${key} mismatch: expected ${expected[key]}, resolved ${actual[key]}`);
  }
  const compilerHash = expected.roslyn.platformHashes?.[target];
  if (!compilerHash || actual.roslyn.version !== expected.roslyn.version || actual.roslyn.sha256 !== compilerHash) throw new Error(`Oracle Roslyn version/hash mismatch for ${target}: expected ${expected.roslyn.version}/${compilerHash}, resolved ${JSON.stringify(actual.roslyn)}`);
  if (actual.referenceAssemblies.sha256 !== expected.referenceAssemblies.sha256 || actual.referenceAssemblies.count !== expected.referenceAssemblies.count) throw new Error(`Oracle reference assembly hash/count mismatch: expected ${JSON.stringify(expected.referenceAssemblies)}, resolved ${JSON.stringify(actual.referenceAssemblies)}`);
}

export function assertImage(env = process.env, currentPlatform = process.platform) {
  if (env.GITHUB_ACTIONS !== 'true') return { kind: 'local', pinnedImage: false, reason: 'Local OS is recorded, not an immutable runner image.' };
  if (['win32', 'darwin'].includes(currentPlatform)) {
    const expected = pin.images[currentPlatform === 'win32' ? 'windows' : 'macos'];
    if (env.ImageOS !== expected.imageOS || env.ImageVersion !== expected.imageVersion) throw new Error(`${currentPlatform} oracle image drift: expected ${expected.imageOS}/${expected.imageVersion}, resolved ${env.ImageOS}/${env.ImageVersion}`);
    return { kind: 'github-hosted', pinnedImage: true, imageOS: env.ImageOS, imageVersion: env.ImageVersion };
  }
  if (currentPlatform === 'linux' && env.SHARPFORGE_ORACLE_CONTAINER === pin.images.linux.container) {
    return { kind: 'container', pinnedImage: true, digest: env.SHARPFORGE_ORACLE_CONTAINER };
  }
  throw new Error('Hosted oracle requires the pinned Linux container or exact Windows/macOS image');
}

export async function resolveToolchain({ checkImage = true, processRunner = runProcess } = {}) {
  const dotnet = process.env.SHARPFORGE_ORACLE_DOTNET || 'dotnet';
  const execute = args => processRunner(dotnet, args, { cwd: oracleRoot });
  const sdkResult = await execute(['--version']);
  if (sdkResult.exitCode !== 0) throw new Error(`Pinned SDK ${pin.sdk} is required: ${sdkResult.stderr}${sdkResult.stdout}`);
  const sdk = sdkResult.stdout.trim();
  if (sdk !== pin.sdk) throw new Error(`Oracle SDK mismatch: expected ${pin.sdk}, resolved ${sdk}`);
  const sdkList = await execute(['--list-sdks']);
  const sdkRow = sdkList.stdout.split(/\r?\n/).find(row => row.startsWith(`${sdk} [`));
  if (!sdkRow) throw new Error('Resolved SDK is absent from dotnet --list-sdks');
  const sdkHome = sdkRow.slice(sdkRow.indexOf('[') + 1, sdkRow.lastIndexOf(']'));
  const dotnetHome = path.dirname(sdkHome);
  const csc = path.join(sdkHome, sdk, 'Roslyn/bincore/csc.dll');
  const runtimeList = await execute(['--list-runtimes']);
  if (!runtimeList.stdout.split(/\r?\n/).some(row => row.startsWith(`Microsoft.NETCore.App ${pin.runtime} [`))) throw new Error(`Exact CoreCLR ${pin.runtime} not installed`);
  const referenceDir = path.join(dotnetHome, 'packs/Microsoft.NETCore.App.Ref', pin.referencePack, 'ref', pin.targetFramework);
  const names = (await readdir(referenceDir)).filter(name => name.endsWith('.dll')).sort();
  const referenceRows = await Promise.all(names.map(async name => ({ name, sha256: sha256(await readFile(path.join(referenceDir, name))) })));
  const compilerVersion = await execute([csc, '-version']);
  const actual = {
    sdk, runtime: pin.runtime, referencePack: pin.referencePack,
    roslyn: { version: compilerVersion.stdout.trim(), sha256: sha256(await readFile(csc)) },
    referenceAssemblies: { count: names.length, sha256: sha256(JSON.stringify(referenceRows)) },
  };
  try { assertPins(actual); } catch(error) {error.actualToolchain=actual;throw error;}
  const image = checkImage ? assertImage() : { kind: 'test', pinnedImage: false };
  return {
    dotnet, csc, references: names.map(name => path.join(referenceDir, name)), actual,
    environment: { platform, osRelease: os.release(), node: process.version, image, imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null },
  };
}

export function requireTarget(oracleId, target = platform) {
  const supported = oracleId === 'winui' ? pin.platforms.winui : pin.platforms.coreclr;
  return supported.includes(target) ? { supported: true, target } : {
    supported: false, target,
    reason: oracleId === 'winui' ? 'WinUI requires Windows x64, Windows build >= 19041 and an interactive desktop.' : `No pinned reference target for ${target}`,
  };
}
