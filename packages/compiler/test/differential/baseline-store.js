/**
 * Storage of the differential pass baseline (SF-A02-T40).
 *
 * The baseline records, per fixture, the comparison axes on which SharpForge currently agrees with Roslyn. It is kept
 * as one file per feature, `baseline/<feature>.json`, with one fixture per line:
 *
 *   {
 *     "generics/generic-method": ["diagnostics", "warnings", "bytecode", "cil"],
 *     "generics/cs0305-arity": ["diagnostics"]
 *   }
 *
 * A fixture that passes no axis has no line. Pull requests that work on different features therefore change
 * different files, and a new fixture is one added line instead of one line in each of four lists.
 * In memory the baseline keeps the shape the harness compares against: `{axis: [fixture id, ...]}`.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** The comparison axes, in the order they are written. */
export const BASELINE_AXES = Object.freeze(['diagnostics', 'warnings', 'bytecode', 'cil', 'directCil']);

/** Directory of the per-feature baseline files. */
export const baselineDirectory = join(dirname(fileURLToPath(import.meta.url)), 'baseline');

const featureOf = id => id.slice(0, id.indexOf('/'));
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function baselineFileNames(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .sort(byCodeUnit);
}

/** The checked-in baseline `{diagnostics,warnings,bytecode,cil,directCil}` (sorted arrays of fixture ids), or empty lists. */
export function loadBaseline(directory = baselineDirectory) {
  const baseline = Object.fromEntries(BASELINE_AXES.map(axis => [axis, []]));
  for (const name of baselineFileNames(directory)) {
    const feature = name.slice(0, -'.json'.length);
    for (const [id, axes] of Object.entries(JSON.parse(readFileSync(join(directory, name), 'utf8')))) {
      if (featureOf(id) !== feature) throw new Error(`baseline/${name}: ${id} belongs to feature '${featureOf(id)}'`);
      for (const axis of axes) {
        if (!BASELINE_AXES.includes(axis)) throw new Error(`baseline/${name}: ${id} names the unknown axis '${axis}'`);
        baseline[axis].push(id);
      }
    }
  }
  for (const axis of BASELINE_AXES) baseline[axis].sort(byCodeUnit);
  return baseline;
}

/** Groups `{axis: [id]}` into `Map<feature, Map<id, [axis]>>`, axes in `BASELINE_AXES` order. */
function groupByFeature(baseline) {
  const features = new Map();
  for (const axis of BASELINE_AXES) {
    for (const id of baseline[axis] ?? []) {
      const feature = featureOf(id);
      if (!features.has(feature)) features.set(feature, new Map());
      const fixtures = features.get(feature);
      if (!fixtures.has(id)) fixtures.set(id, []);
      fixtures.get(id).push(axis);
    }
  }
  return features;
}

/** Text of one feature's baseline file: one fixture per line, sorted by id, `\n` line endings. */
function formatFeature(fixtures) {
  const rows = [...fixtures.keys()].sort(byCodeUnit).map(id => `  ${JSON.stringify(id)}: [${fixtures.get(id).map(axis => JSON.stringify(axis)).join(', ')}]`);
  return `{\n${rows.join(',\n')}\n}\n`;
}

/**
 * Writes the baseline as `baseline/<feature>.json` and removes the files of features that no longer pass anything.
 * A file whose content would not change is left untouched.
 */
export function saveBaseline(baseline, directory = baselineDirectory) {
  const features = groupByFeature(baseline);
  mkdirSync(directory, { recursive: true });
  for (const name of baselineFileNames(directory)) {
    if (!features.has(name.slice(0, -'.json'.length))) rmSync(join(directory, name));
  }
  for (const [feature, fixtures] of features) {
    const path = join(directory, `${feature}.json`);
    const text = formatFeature(fixtures);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  }
}
