import { resolveTask } from '../../planning/lib/task-ref.js';

function declaredArea(body) {
  // Release tasks declare their owning area in the live issue's metadata.
  // Keep the same bounded plain/bold inline header format as backlog snapshots.
  if (typeof body !== 'string') return undefined;
  const header = body.split(/^##[ \t]/m, 1)[0];
  const field = header.match(/(?:^|[.·][ \t]+)[ \t]*(?:\*\*)?Area:(?:\*\*)?[ \t]*([^\r\n]*)/m)?.[1];
  const value = field?.split(/[ \t]+·[ \t]+|\.[ \t]+(?=(?:\*\*)?[A-Z][\w ]*:)/, 1)[0];
  return value?.match(/^(?:\*\*)?(A\d{2})(?:\*\*)?(?=[ \t.·]|$)/)?.[1];
}

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
  const area = task.match(/^SF-(A\d{2})-/)?.[1] ?? declaredArea(items[0].content.body);
  if (!area) throw new Error(`Release task ${task} requires an explicit Area declaration in its live issue header`);
  return { task, area, locks };
}
