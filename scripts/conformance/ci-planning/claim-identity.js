import { resolveTask } from '../../planning/lib/task-ref.js';

/** Resolve claims from authoritative refs, never from a PR's self-declared lock list. */
export async function claimedIdentity(client, pullRequest, now = Date.now()) {
  const task = resolveTask({ branch: pullRequest.head.ref, body: pullRequest.body ?? '' });
  const items = (await client.items()).filter(item => item.fields['Work ID'] === task || item.content.title.startsWith(`[${task}]`));
  if (items.length !== 1) throw new Error(`Task ${task} must identify exactly one project item`);
  resolveTask({ branch: pullRequest.head.ref, body: pullRequest.body ?? '', projectBranch: items[0].fields.Branch });
  const ref = await client.ref(`agent/${task}`);
  if (!ref) throw new Error(`Task ${task} has no authoritative claim`);
  const claim = await client.readRecord(ref.object.sha);
  if (claim.task !== task || claim.branch !== pullRequest.head.ref || !Number.isFinite(Date.parse(claim.expires)) || Date.parse(claim.expires) <= now) {
    throw new Error(`Task ${task} has a mismatched or expired claim`);
  }
  const locks = [];
  for (const key of claim.locks) {
    const lock = await client.ref(`agent-locks/${key}`);
    const record = lock ? await client.readRecord(lock.object.sha) : null;
    if (!record || record.generation !== claim.generation || record.task !== task) throw new Error(`Unverified lock ${key}`);
    locks.push({ key, paths: record.paths ?? [] });
  }
  const area = task.match(/^SF-(A\d{2})-/)?.[1];
  if (!area) throw new Error('Release overlays require an explicit area-owned task for planning gates');
  return { task, area, locks };
}

