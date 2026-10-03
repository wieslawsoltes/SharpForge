/**
 * Fixture corpus and pinned-result storage for the Roslyn differential harness (SF-A02-T40).
 *
 * This module does not import the compiler, so the pinning tool can run even while the compiler is being reworked.
 * The fixtures are discovered from `fixtures/` (see fixture-discovery.js): there is no list to maintain here.
 * Pinned results live in `pinned/<feature>.json`, one fixture per line, keyed by fixture id and guarded by a content
 * hash so that an edited fixture with a stale pin is detected instead of silently compared against old results.
 * The pass baseline lives in `baseline/<feature>.json` (see baseline-store.js).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverFixtures, validateFixtures } from './fixture-discovery.js';

export { loadBaseline, saveBaseline, baselineDirectory } from './baseline-store.js';

/** Directory of the differential harness. */
export const root = dirname(fileURLToPath(import.meta.url));
/** Directory holding the pinned Roslyn results. */
export const pinnedDirectory = join(root, 'pinned');

const PINNED_SHAPE = 'diagnostics are [code, startOffset, length, severity]; output is stdout with \\\\n newlines';

// Fixture modules are imported once, when this module loads, so that `loadFixtures` stays synchronous for its callers.
const discovered = validateFixtures(await discoverFixtures());

/** Stable content hash of what Roslyn was shown for a fixture (language version + source). */
export function fixtureHash(fixture) {
  return createHash('sha256')
    .update((fixture.langVersion ?? '') + '\0' + fixture.source)
    .digest('hex')
    .slice(0, 16);
}

/** Every fixture `{id,feature,kind,langVersion?,source}`, validated for unique ids and well-formed fields. */
export function loadFixtures() {
  return [...discovered];
}

/** Pinned Roslyn results as `{meta,results:Map<id,{hash,kind,langVersion,diagnostics,output?,exception?,exitCode?}>}`. */
export function loadPinned() {
  const results = new Map();
  let meta = null;
  if (!existsSync(pinnedDirectory)) return { meta, results };
  const names = readdirSync(pinnedDirectory)
    .filter(name => name.endsWith('.json'))
    .sort();
  for (const name of names) {
    const document = JSON.parse(readFileSync(join(pinnedDirectory, name), 'utf8'));
    meta ??= document.roslyn;
    for (const [id, value] of Object.entries(document.fixtures)) results.set(id, value);
  }
  return { meta, results };
}

/** Rewrite `pinned/*.json` from a complete `Map<id,result>`; one file per feature, one fixture per line. */
export function savePinned(meta, fixtures, results) {
  rmSync(pinnedDirectory, { recursive: true, force: true });
  mkdirSync(pinnedDirectory, { recursive: true });
  const byFeature = new Map();
  for (const fixture of fixtures) {
    if (!byFeature.has(fixture.feature)) byFeature.set(fixture.feature, []);
    byFeature.get(fixture.feature).push(fixture);
  }
  for (const [feature, list] of byFeature) {
    const rows = list.map(fixture => `  ${JSON.stringify(fixture.id)}:${JSON.stringify(results.get(fixture.id))}`);
    const text = `{"roslyn":${JSON.stringify(meta)},"shape":"${PINNED_SHAPE}","fixtures":{\n${rows.join(',\n')}\n}}\n`;
    writeFileSync(join(pinnedDirectory, feature + '.json'), text);
  }
}
