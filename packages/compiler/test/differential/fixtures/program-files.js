/**
 * Fixture families kept as C# files (SF-A02-T30): `<family>/<feature>/<name>.cs` is the output fixture
 * `<feature>/<name>`. A program is a real file, so it can be built with `dotnet` as it is and needs no escaping.
 *
 * The programs use the base class library freely, so they are bound against reference assemblies only
 * (`referencesOnly`): their axis is real .NET (`tools/dotnet-axis.mjs`, `tests/compiler-stress-corpus.test.js`), and
 * the axes that bind against the closed framework registry report them as unsupported.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { out, feature } from './kit.js';

const fixturesDirectory = dirname(fileURLToPath(import.meta.url));
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** The names in `directory` that satisfy `accept`, sorted by code unit so the order is the same on every platform. */
function sortedNames(directory, accept) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(accept)
    .map(entry => entry.name)
    .sort(byCodeUnit);
}

/**
 * The programs of one feature directory as output fixtures; line ends are normalised so the pin hash is portable.
 * A feature whose name ends in `-unsafe` is compiled with `/unsafe`.
 */
function programsOf(directory, featureName) {
  const options = { referencesOnly: true, ...(featureName.endsWith('-unsafe') ? { allowUnsafe: true } : {}) };
  return sortedNames(directory, entry => entry.isFile() && entry.name.endsWith('.cs')).map(name => {
    const source = readFileSync(join(directory, name), 'utf8').replace(/\r\n?/g, '\n');
    return out(name.slice(0, -'.cs'.length), source, options);
  });
}

/**
 * Every program of a family.
 * @param {string} family the directory under `fixtures/` whose sub-directories are the features
 * @returns {object[]} output fixtures, features and programs in name order
 */
export function programFamily(family) {
  const directory = join(fixturesDirectory, family);
  return sortedNames(directory, entry => entry.isDirectory()).flatMap(name => feature(name, programsOf(join(directory, name), name)));
}
