import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameworkManifest } from '@sharpforge/framework';
import { generateParityMatrix } from './matrix.js';
import { assertNoCoverageRegression } from './gap-export.js';
import { generateParityMarkdown } from './docs-generator.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sealed = 'planning/qualification/inventory/winui-api.json';
const supplement = 'packages/winui-controls/parity/winappsdk-inventory.json';
const readJSON = async file => JSON.parse(await readFile(path.resolve(root, file), 'utf8'));

async function defaultReference() {
  try { await access(path.join(root, supplement)); return supplement; }
  catch (error) { if (error.code === 'ENOENT') return sealed; throw error; }
}

export async function writeParityInventory({ reference, baseline = sealed, output = 'artifacts/results/a16-family-parity',
  evidence = null, writeDoc = null, check = false } = {}) {
  reference ??= await defaultReference();
  const [inventory, policies, previous, behaviorEvidence] = await Promise.all([
    readJSON(reference), readJSON('packages/winui-controls/parity/deviations.json'), readJSON(baseline),
    evidence ? readJSON(evidence) : []]);
  const matrix = generateParityMatrix(inventory, frameworkManifest, { policies, behaviorEvidence });
  if (check) assertNoCoverageRegression(previous, matrix);
  const directory = path.resolve(root, output);
  await mkdir(directory, { recursive: true });
  const markdown = generateParityMarkdown(matrix);
  await Promise.all([writeFile(path.join(directory, 'matrix.json'), JSON.stringify(matrix, null, 2) + '\n'),
    writeFile(path.join(directory, 'matrix.md'), markdown),
    writeFile(path.join(directory, 'gaps.json'), JSON.stringify(matrix.gaps, null, 2) + '\n'),
    writeFile(path.join(directory, 'deviations.json'), JSON.stringify(matrix.deviations, null, 2) + '\n')]);
  if (writeDoc) await writeFile(path.resolve(root, writeDoc), markdown);
  return matrix;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const option = process.argv[index];
    if (option === '--check') options.check = true;
    else if (['--reference', '--baseline', '--output', '--evidence', '--write-doc'].includes(option)) {
      if (!process.argv[index + 1]) throw new TypeError('Missing value for ' + option);
      options[option === '--write-doc' ? 'writeDoc' : option.slice(2)] = process.argv[++index];
    } else throw new TypeError('Unknown parity option: ' + option);
  }
  const matrix = await writeParityInventory(options);
  console.log(JSON.stringify(matrix.totals));
}
