import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, join, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { capture, jsonBytes, loadStage, regularBytes } from './evidence/inventory.js';
import { migrate, migrationPlan } from './evidence/migration.js';
import { verifyPublished } from './evidence/release.js';
import { publicationPlan } from './evidence/publication.js';

const POLICY = 'planning/qualification/evidence-archive.json';
const PLAN = 'MIGRATION-PLAN.json';

/** Stage, verify or migrate historical evidence. Uploads are an explicit separate release operation. */
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    mode: { type: 'string' }, root: { type: 'string', default: '.' }, stage: { type: 'string' },
    commit: { type: 'string' }, repository: { type: 'string', default: 'wieslawsoltes/SharpForge' },
    tag: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('archive-evidence.js --mode prepare|verify|migrate --stage DIR [--commit FULL_SHA --tag evidence-archive-NAME]');
    return;
  }
  if (!['prepare', 'verify', 'migrate'].includes(values.mode) || !values.stage) throw new Error('Mode and stage directory are required');
  const root = await realpath(resolve(values.root));
  const requested = resolve(values.stage);
  const directory = join(await realpath(dirname(requested)), basename(requested));
  if (directory === root || directory.startsWith(join(root, 'docs') + sep) || directory === join(root, 'docs')) {
    throw new Error('Stage outside docs and the repository root');
  }
  const policy = JSON.parse(await regularBytes(root, POLICY));
  if (values.mode === 'prepare') {
    const stage = capture(root, policy, { repository: values.repository, commit: values.commit, tag: values.tag });
    const plan = await migrationPlan(root, stage.manifest);
    await mkdir(directory);
    for (const [name, bytes] of stage.payloads) await writeFile(join(directory, name), bytes, { flag: 'wx' });
    await writeFile(join(directory, PLAN), jsonBytes(plan), { flag: 'wx' });
    const publication = publicationPlan(stage, directory);
    await writeFile(join(directory, 'UPLOAD-PLAN.json'), jsonBytes(publication.plan), { flag: 'wx' });
    await writeFile(join(directory, 'RELEASE-NOTES.md'), publication.notes, { flag: 'wx' });
    console.log(`Prepared ${stage.manifest.files.length} historical reports and ${plan.rewrites.length} proposed consumer rewrites in ${directory}`);
    return;
  }
  const stage = await loadStage(root, directory, policy);
  const receipt = values.mode === 'verify' ? await verifyPublished(stage) :
    await migrate(root, stage, JSON.parse(await regularBytes(directory, PLAN)));
  await writeFile(join(directory, `VERIFIED-${values.mode}.json`), jsonBytes(receipt), { flag: 'wx' });
  console.log(`${values.mode}: downloaded and verified ${receipt.assets.length} assets at ${receipt.snapshotCommit}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
