import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../planning/schema/validate.js';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
export function within(base, path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.includes('\0')
  )
    throw new Error('Invalid relative path');
  const full = resolve(base, path),
    local = relative(base, full);
  if (
    !local ||
    local === '..' ||
    local.startsWith('..' + sep) ||
    isAbsolute(local)
  )
    throw new Error('Path escapes workspace');
  return full;
}
export async function readScenario(path) {
  const bytes = await readFile(path);
  if (bytes.length > 1024 * 1024) throw new Error('Scenario exceeds 1 MiB');
  const scenario = JSON.parse(bytes);
  const schema = JSON.parse(
    await readFile(
      new URL(
        '../../../tests/conformance/acceptance/scenario.schema.json',
        import.meta.url,
      ),
    ),
  );
  validate(schema, scenario, { maxNodes: 20000 });
  const ids = new Set();
  for (const step of scenario.steps) {
    if (ids.has(step.id)) throw new Error('Duplicate step: ' + step.id);
    ids.add(step.id);
    for (const key of ['path', 'entry', 'startup'])
      if (step[key]) within(root, step[key]);
    for (const point of step.points ?? []) within(root, point.path);
  }
  return scenario;
}
