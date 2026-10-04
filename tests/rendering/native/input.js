import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oracleRoot, pin } from '../../../scripts/conformance/oracle/toolchain.js';
import { hash, limits, validateCatalog } from './contract.js';

export const directory = fileURLToPath(new URL('./', import.meta.url));
export const runtimeFiles = ['Oracle.WinUI.csproj', 'app.manifest', 'packages.lock.json'];
export const nativeFiles = ['Program.cs', 'NativeCapture.cs', 'ShapeDefaults.cs'];

export async function boundedRead(file, parent, bound) {
  const canonical = await realpath(file);
  if (path.dirname(canonical) !== parent) throw new Error('SFNPIX007: Native capture source escapes its declared directory');
  const information = await stat(canonical);
  if (!information.isFile() || information.size > bound) throw new Error('SFNPIX007: Native source byte budget exceeded');
  const bytes = await readFile(canonical);
  if (bytes.length > bound) throw new Error('SFNPIX007: Native source changed beyond its byte budget');
  return bytes;
}

/** Load pinned input bytes; reject path traversal, symlink escapes, stale hashes and aggregate input overflow. */
export async function loadInput(sourceRoot = directory) {
  const canonical = await realpath(sourceRoot);
  const fixturesRoot = await realpath(path.join(sourceRoot, 'fixtures'));
  if (path.dirname(fixturesRoot) !== canonical) throw new Error('SFNPIX007: Fixture directory escapes harness');
  const catalogBytes = await boundedRead(path.join(sourceRoot, 'fixtures.json'), canonical, limits.reportBytes);
  const catalog = validateCatalog(JSON.parse(catalogBytes));
  const materials = [{ name: 'fixtures.json', sha256: hash(catalogBytes) }];
  const texts = new Map(), fixtures = [];
  let inputBytes = 0;
  for (const fixture of catalog.fixtures) {
    if (!texts.has(fixture.file)) {
      const bytes = await boundedRead(path.join(fixturesRoot, fixture.file), fixturesRoot, limits.xamlBytes);
      const xaml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      texts.set(fixture.file, { bytes, xaml });
      materials.push({ name: 'fixtures/' + fixture.file, sha256: hash(bytes) });
    }
    const entry = texts.get(fixture.file);
    inputBytes += entry.bytes.length;
    if (inputBytes > limits.inputBytes) throw new Error('SFNPIX007: XAML input exceeds aggregate byte budget');
    if (hash(entry.bytes) !== fixture.xamlSha256) throw new Error('SFNPIX007: XAML fixture hash mismatch: ' + fixture.id);
    fixtures.push({ ...fixture, xaml: entry.xaml });
  }
  const sources = {};
  for (const name of [...nativeFiles, 'contract.js', 'input.js', 'capture.js', 'capture-project.js']) {
    const bytes = await boundedRead(path.join(sourceRoot, name), canonical, limits.xamlBytes);
    if (nativeFiles.includes(name)) sources[name] = bytes;
    materials.push({ name, sha256: hash(bytes) });
  }
  for (const name of runtimeFiles) materials.push({ name: 'native/' + name, sha256: hash(await readFile(path.join(oracleRoot, 'WinUI', name))) });
  for (const name of ['global.json', 'NuGet.Config']) {
    materials.push({ name: 'native/' + name, sha256: hash(await readFile(path.join(oracleRoot, name))) });
  }
  materials.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return { fixtures, sources, materials, inputHash: hash(JSON.stringify({ materials, pin, culture: 'en-US', captureProfile: 'static-xaml' })) };
}
