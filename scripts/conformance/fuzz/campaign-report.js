import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const statuses = new Set(['passed', 'failed', 'unsupported', 'cancelled', 'incomplete']);

/** Missing targets, changed source and unsupported work never produce a passing report. */
export function campaignStatus(results, expectedTargets, sourceBefore, sourceAfter) {
  if (results.some(result => !statuses.has(result.status) || result.status === 'failed')) return 'failed';
  if (results.some(result => result.status === 'cancelled')) return 'cancelled';
  if (!expectedTargets.length) return 'incomplete';
  const observed = results.map(result => result.targetId);
  if (observed.length !== expectedTargets.length || new Set(observed).size !== observed.length ||
      expectedTargets.some(target => !observed.includes(target))) return 'incomplete';
  if (!sourceBefore.clean || !sourceAfter.clean || !sourceBefore.commit || !sourceBefore.tree ||
      sourceBefore.commit !== sourceAfter.commit || sourceBefore.tree !== sourceAfter.tree) return 'incomplete';
  if (results.some(result => result.status === 'incomplete')) return 'incomplete';
  if (results.some(result => result.status === 'unsupported')) return 'unsupported';
  return 'passed';
}

export function campaignExitCode(status) {
  return status === 'passed' ? 0 : status === 'failed' ? 1 : 2;
}

/** Exclusive report creation preserves earlier failure evidence on accidental reruns. */
export async function writeCampaignReport(directory, report, name = 'campaign.json') {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error('Invalid report filename');
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(directory, name), bytes, { flag: 'wx' });
  return { path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
