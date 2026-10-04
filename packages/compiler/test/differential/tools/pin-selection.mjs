/** Exact fixture selection and incremental pin writes; no compiler or reference process is imported here. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PINNED_SHAPE = 'diagnostics are [code, startOffset, length, severity]; output is stdout with \\\\n newlines';

/** Repeatable `--only id,id` (or `--only=id`) selects exact ids before the optional stale-pin filter. */
export function selectPinnedFixtures(args, fixtures, current) {
  const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  const requested = new Set();
  let restricted = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== '--only' && !arg.startsWith('--only=')) continue;
    restricted = true;
    const value = arg === '--only' ? args[++i] : arg.slice('--only='.length);
    if (!value || value.startsWith('--')) throw new Error('--only requires one or more exact fixture ids');
    for (const entry of value.split(',')) {
      const id = entry.trim();
      if (!id) throw new Error('--only contains an empty fixture id');
      if (!byId.has(id)) throw new Error(`--only names an unknown fixture: ${id}`);
      if (requested.has(id)) throw new Error(`--only selects a fixture more than once: ${id}`);
      requested.add(id);
    }
  }
  const selected = restricted ? [...requested].map(id => byId.get(id)) : fixtures;
  return args.includes('--changed') ? selected.filter(fixture => !current(fixture)) : [...selected];
}

/**
 * Merge captured results into only their feature files. Unselected rows keep their order and values; unrelated
 * files are never rewritten or removed. Validate every result/document before performing the first write.
 */
export function writeSelectedPins(meta, fixtures, results, directory, hashOf) {
  const byFeature = new Map();
  for (const fixture of fixtures) {
    if (!/^[a-z0-9-]+$/.test(fixture.feature) || !fixture.id.startsWith(fixture.feature + '/'))
      throw new Error(`Invalid pinned feature for ${fixture.id}`);
    const result = results.get(fixture.id);
    if (!result || result.hash !== hashOf(fixture) || result.kind !== fixture.kind)
      throw new Error(`Missing or stale captured result for ${fixture.id}`);
    if (!byFeature.has(fixture.feature)) byFeature.set(fixture.feature, []);
    byFeature.get(fixture.feature).push(fixture);
  }
  const updates = [];
  for (const [feature, selected] of byFeature) {
    const path = join(directory, feature + '.json');
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const document = previous === null ? { shape: PINNED_SHAPE, fixtures: {} } : JSON.parse(previous);
    if (!document.fixtures || Array.isArray(document.fixtures) || typeof document.fixtures !== 'object')
      throw new Error(`Invalid pinned fixture document: ${path}`);
    for (const fixture of selected) document.fixtures[fixture.id] = results.get(fixture.id);
    const rows = Object.entries(document.fixtures).map(([id, result]) => `  ${JSON.stringify(id)}:${JSON.stringify(result)}`);
    const header = `{"roslyn":${JSON.stringify(meta)},"shape":${JSON.stringify(document.shape ?? PINNED_SHAPE)},"fixtures":{`;
    const text = `${header}\n${rows.join(',\n')}\n}}\n`;
    if (text !== previous) updates.push({ path, text });
  }
  if (updates.length) mkdirSync(directory, { recursive: true });
  for (const update of updates) writeFileSync(update.path, update.text);
}
