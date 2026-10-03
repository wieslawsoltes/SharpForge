import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const corpus = path.join(root, 'tests/conformance/suites');
export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
export const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
export async function files(directory, suffix) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name, 'en'),
  )) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(file, suffix)));
    else if (entry.isFile() && file.endsWith(suffix)) result.push(file);
  }
  return result;
}
export async function upstream(directory, name) {
  const pins = await json(
    path.join(root, 'planning/qualification/suites/pins.json'),
  );
  const pin = pins.sources.find((row) => row.name === name);
  if (!pin) throw Error('Unpinned upstream ' + name);
  const license = await readFile(path.join(directory, pin.licensePath));
  if (sha256(license) !== pin.licenseSHA256)
    throw Error('Upstream license mismatch');
  return { ...pin, directory };
}
export async function source(pin, file) {
  const relative = path.relative(pin.directory, file).split(path.sep).join('/');
  if (relative.startsWith('../') || (await stat(file)).size > 8 * 1024 * 1024)
    throw Error('Invalid upstream source path/size');
  const bytes = await readFile(file);
  return {
    text: bytes.toString('utf8'),
    provenance: {
      repository: pin.repository,
      commit: pin.commit,
      path: relative,
      sha256: sha256(bytes),
      url: `https://github.com/${pin.repository}/blob/${pin.commit}/${relative}`,
      license: pin.license,
    },
  };
}
export async function saveSuite(name, cases, skipped = []) {
  const directory = path.join(corpus, name);
  await mkdir(directory, { recursive: true });
  if (new Set(cases.map((row) => row.id)).size !== cases.length)
    throw Error('Duplicate imported identity');
  let previous;
  try {
    previous = await json(path.join(directory, 'manifest.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const entry of previous?.entries ?? []) {
    if (!/^[a-z]+-[0-9a-f]{20}\.json$/.test(entry.file))
      throw Error('Invalid old manifest entry');
    await rm(path.join(directory, entry.file), { force: true });
  }
  const entries = [];
  for (const row of cases) {
    const bytes =
      JSON.stringify(
        { schemaVersion: 1, qualification: 'unmeasured', ...row },
        null,
        2,
      ) + '\n';
    const file = row.id + '.json';
    await writeFile(path.join(directory, file), bytes);
    entries.push({ id: row.id, file, sha256: sha256(bytes) });
  }
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        suite: name,
        imported: entries.length,
        qualification: 'unmeasured',
        entries,
        skipped,
      },
      null,
      2,
    ) + '\n',
  );
  return { suite: name, imported: entries.length, skipped: skipped.length };
}
export const main = (url) =>
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
