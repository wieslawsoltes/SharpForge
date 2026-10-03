/**
 * Discovers the differential fixtures (SF-A02-T40) from `fixtures/`.
 *
 * Every module in `fixtures/` that exports an array named `fixtures` contributes to the corpus; modules without that
 * export (helpers such as `kit.js`) are ignored. There is no registry to edit: adding a fixture family is adding one
 * file, so parallel pull requests no longer meet on a shared import list.
 *
 * Modules are loaded in file-name order, which makes the corpus order deterministic on every platform. A module may
 * re-export fixtures of another module (an aggregator); the same fixture object is counted once.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** Directory of the fixture modules. */
export const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const FIXTURE_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** Names of the JavaScript modules in `directory`, sorted by code unit so the order does not depend on the locale. */
export function fixtureModuleNames(directory = fixturesDirectory) {
  return readdirSync(directory)
    .filter(name => name.endsWith('.js'))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Imports every fixture module of `directory` and returns the distinct fixtures in module order.
 * Throws when a module's `fixtures` export is not an array.
 */
export async function discoverFixtures(directory = fixturesDirectory) {
  const distinct = new Set();
  for (const name of fixtureModuleNames(directory)) {
    const module = await import(pathToFileURL(join(directory, name)).href);
    if (module.fixtures === undefined) continue;
    if (!Array.isArray(module.fixtures)) throw new Error(`fixtures/${name}: the 'fixtures' export must be an array`);
    for (const fixture of module.fixtures) distinct.add(fixture);
  }
  return [...distinct];
}

/** Checks ids (unique, `feature/name`), kinds and sources of a fixture list; returns the list. */
export function validateFixtures(fixtures) {
  const seen = new Set();
  for (const fixture of fixtures) {
    if (typeof fixture.id !== 'string' || !FIXTURE_ID.test(fixture.id)) throw new Error(`Invalid fixture id ${JSON.stringify(fixture.id)}`);
    if (seen.has(fixture.id)) throw new Error(`Duplicate fixture id ${fixture.id}`);
    seen.add(fixture.id);
    if (fixture.kind !== 'output' && fixture.kind !== 'diagnostics') throw new Error(`${fixture.id}: kind must be 'output' or 'diagnostics'`);
    if (typeof fixture.source !== 'string' || !fixture.source.trim()) throw new Error(`${fixture.id}: empty source`);
  }
  return fixtures;
}
