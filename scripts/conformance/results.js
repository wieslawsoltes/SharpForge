import {mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export async function resultPath(name, directory = process.env.SHARPFORGE_RESULTS_DIR) {
  const target = resolve(repository, directory || 'artifacts/results', name);
  await mkdir(dirname(target), {recursive: true});
  return target;
}
