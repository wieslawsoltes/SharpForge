/**
 * The stress family of the differential corpus (SF-A02-T30): realistic programs of 60-200 lines that combine
 * features the way application code does, instead of one feature per fixture. They were written after the
 * feature fixtures, to find what a corpus written next to the features does not cover.
 *
 * Every program is a C# file of its own under `stress/<feature>/<name>.cs` (a real file, so that it can be built
 * with `dotnet` as it is); the fixture id is `<feature>/<name>`. All of them are output fixtures: Roslyn compiles
 * them without errors and their standard output is pinned by `tools/pin.mjs`.
 *
 * They use the base class library freely, so they are bound against reference assemblies only (`referencesOnly`):
 * their axis is real .NET (`tools/dotnet-axis.mjs`, `tests/compiler-stress-corpus.test.js`), and the axes that bind
 * against the closed framework registry report them as unsupported.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { out, feature } from './kit.js';

const stressDirectory = join(dirname(fileURLToPath(import.meta.url)), 'stress');
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** The names in `directory` that satisfy `accept`, sorted by code unit so the order is the same on every platform. */
function sortedNames(directory, accept) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(accept)
    .map(entry => entry.name)
    .sort(byCodeUnit);
}

/** The programs of one feature directory as output fixtures; line ends are normalised so the pin hash is portable. */
function programsOf(featureName) {
  const directory = join(stressDirectory, featureName);
  return sortedNames(directory, entry => entry.isFile() && entry.name.endsWith('.cs')).map(name => {
    const source = readFileSync(join(directory, name), 'utf8').replace(/\r\n?/g, '\n');
    return out(name.slice(0, -'.cs'.length), source, { referencesOnly: true });
  });
}

export const fixtures = sortedNames(stressDirectory, entry => entry.isDirectory()).flatMap(name => feature(name, programsOf(name)));
