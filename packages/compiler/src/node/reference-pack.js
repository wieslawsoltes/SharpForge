/**
 * Locates and reads the .NET reference pack (`Microsoft.NETCore.App.Ref`) of an installed .NET SDK, for hosts that
 * run on Node: the command line, tests and tools. The compiler itself never touches the file system; it receives
 * the assemblies as the `references` option.
 *
 * The pack lives at `<dotnet root>/packs/Microsoft.NETCore.App.Ref/<version>/ref/net<major>.<minor>/*.dll`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createReferenceSet } from '../metadata-import/reference-set.js';

const PACK_NAME = 'Microsoft.NETCore.App.Ref';

/** The directories a .NET installation is looked for in, most specific first. */
export function dotnetRootCandidates(environment = process.env) {
  const candidates = [environment.DOTNET_ROOT, join(homedir(), '.dotnet')];
  if (process.platform === 'win32') {
    candidates.push(join(environment.ProgramFiles ?? 'C:\\Program Files', 'dotnet'));
  } else {
    candidates.push('/usr/local/share/dotnet', '/usr/share/dotnet', '/usr/lib/dotnet', '/opt/homebrew/opt/dotnet/libexec');
  }
  return candidates.filter(Boolean);
}

/** `10.0.5` and `11.0.0-preview.4.26230.115` as comparable parts; a release sorts after its previews. */
function versionParts(version) {
  const [release, preview] = version.split('-', 2);
  return { numbers: release.split('.').map(Number), preview: preview ?? null };
}

function compareVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference) return difference;
  }
  if (a.preview === b.preview) return 0;
  if (a.preview === null) return 1;
  if (b.preview === null) return -1;
  return a.preview < b.preview ? -1 : 1;
}

function packVersions(root) {
  const packs = join(root, 'packs', PACK_NAME);
  if (!existsSync(packs)) return [];
  return readdirSync(packs)
    .filter(name => /^\d+\.\d+\.\d+/.test(name))
    .map(version => ({ version, directory: join(packs, version, 'ref', 'net' + version.split('.').slice(0, 2).join('.')) }))
    .filter(pack => existsSync(pack.directory));
}

/**
 * Finds an installed reference pack.
 * @param {object} [options] `dotnetRoot`: the only installation to look in (default: `dotnetRootCandidates()`);
 *   `targetFramework`: `'net10.0'` to require that framework (default: the newest release, else the newest preview);
 *   `environment`: the environment `DOTNET_ROOT` is read from
 * @returns {{directory: string, version: string, targetFramework: string, files: string[]}|null} `files` are the
 *   assembly paths in name order; null when no installation has a matching pack
 */
export function locateReferencePack(options = {}) {
  const roots = options.dotnetRoot ? [options.dotnetRoot] : dotnetRootCandidates(options.environment);
  for (const root of roots) {
    const wanted = packVersions(root).filter(pack => !options.targetFramework || pack.directory.endsWith(options.targetFramework));
    const releases = wanted.filter(pack => !pack.version.includes('-'));
    const best = (releases.length ? releases : wanted).sort((a, b) => compareVersions(b.version, a.version))[0];
    if (!best) continue;
    const files = readdirSync(best.directory)
      .filter(name => name.toLowerCase().endsWith('.dll'))
      .sort()
      .map(name => join(best.directory, name));
    const targetFramework = 'net' + best.version.split('.').slice(0, 2).join('.');
    return { directory: best.directory, version: best.version, targetFramework, files };
  }
  return null;
}

/** Reads assembly files as `{ bytes, display }` reference entries; `display` is the path. */
export function readReferenceFiles(paths) {
  return paths.map(path => ({ bytes: new Uint8Array(readFileSync(path)), display: path }));
}

/**
 * The installed reference pack as a reference set (see `createReferenceSet`), ready to pass as `references`.
 * @param {object} [options] see `locateReferencePack`
 * @returns {{references: object[], pack: object}|null} null when no reference pack is installed
 */
export function loadReferencePack(options = {}) {
  const pack = locateReferencePack(options);
  return pack ? { references: createReferenceSet(readReferenceFiles(pack.files)), pack } : null;
}
