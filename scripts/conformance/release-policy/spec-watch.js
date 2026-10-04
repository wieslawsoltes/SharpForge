import { parseArgs } from 'node:util';
import { isMain } from '../supply/files.js';
import { github, repositoryPath, pages } from './github.js';
import { policyJSON, sha256 } from './data.js';

const releaseTag = /^v?(\d+)\.(\d+)\.(\d+)(?:[-.]([\w.-]+))?$/;

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareNumeric(left, right) {
  // Tags can contain identifiers beyond Number's exact integer range.
  const a = left.replace(/^0+(?=\d)/, '');
  const b = right.replace(/^0+(?=\d)/, '');
  return a.length - b.length || compareText(a, b);
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumeric(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return compareText(left, right);
}

function versionOrder(left, right) {
  const a = releaseTag.exec(left.tag_name).slice(1);
  const b = releaseTag.exec(right.tag_name).slice(1);
  for (let index = 0; index < 3; index++) {
    const order = compareNumeric(b[index], a[index]);
    if (order) return order;
  }
  if ((a[3] === undefined) !== (b[3] === undefined)) return a[3] === undefined ? -1 : 1;
  const leftPreview = a[3]?.split('.') ?? [];
  const rightPreview = b[3]?.split('.') ?? [];
  for (let index = 0; index < Math.min(leftPreview.length, rightPreview.length); index++) {
    const order = compareIdentifier(rightPreview[index], leftPreview[index]);
    if (order) return order;
  }
  return rightPreview.length - leftPreview.length
    || Date.parse(right.published_at) - Date.parse(left.published_at);
}

export function observedRevisions(feed, payload) {
  if (feed.kind === 'commit') {
    if (!/^[a-f0-9]{40}$/.test(payload?.sha ?? '')) throw new Error('Malformed upstream commit');
    return [{ channel: 'preview', revision: payload.sha }];
  }
  if (feed.kind !== 'releases' || !Array.isArray(payload) || payload.length > 100 || !payload.length) {
    throw new Error('Missing or malformed upstream releases');
  }
  const releases = payload.filter((row) => !row.draft);
  for (const row of releases) {
    if (!releaseTag.test(row.tag_name ?? '')
        || row.tag_name.length > 128 || typeof row.prerelease !== 'boolean'
        || !Number.isFinite(Date.parse(row.published_at))) throw new Error('Malformed release identity');
  }
  const result = [];
  for (const channel of ['stable', 'preview']) {
    const row = releases.filter((item) => item.prerelease === (channel === 'preview')).sort(versionOrder)[0];
    if (row) result.push({ channel, revision: row.tag_name });
  }
  if (!result.length) throw new Error('No published upstream release');
  return result;
}

export async function watch({ feeds, api, repository, writeIssues = false, signal } = {}) {
  if (feeds?.schemaVersion !== 1 || !Array.isArray(feeds.feeds) || !feeds.feeds.length || feeds.feeds.length > 20) {
    throw new Error('Invalid tracked feed configuration');
  }
  const changes = [];
  const seen = new Set();
  for (const feed of feeds.feeds) {
    signal?.throwIfAborted();
    if (!/^[\w-]+$/.test(feed.id ?? '') || seen.has(feed.id) || !feed.pinned || !feed.specRevision) {
      throw new Error('Malformed or duplicate tracked feed');
    }
    seen.add(feed.id);
    const prefix = repositoryPath(feed.repository);
    const endpoint = feed.kind === 'commit'
      ? `${prefix}/commits/${encodeURIComponent(feed.branch)}` : `${prefix}/releases?per_page=100`;
    for (const observation of observedRevisions(feed, await api(endpoint))) {
      if (observation.revision === feed.pinned[observation.channel]) continue;
      const marker = '<!-- sharpforge-spec-review:' + sha256(JSON.stringify([feed.id, observation])) + ' -->';
      changes.push({
        feed: feed.id, repository: feed.repository, specRevision: feed.specRevision, marker,
        previous: feed.pinned[observation.channel] ?? null, ...observation,
      });
    }
  }
  const issues = changes.length && writeIssues
    ? await pages(api, repositoryPath(repository) + '/issues?state=all', { limit: 100, signal }) : [];
  for (const change of changes) {
    signal?.throwIfAborted();
    const existing = issues.filter((issue) => !issue.pull_request && issue.body?.includes(change.marker));
    if (existing.length > 1) throw new Error('Duplicate revision review issues require reconciliation');
    if (existing.length) { change.issue = existing[0].number; continue; }
    if (!writeIssues) continue;
    const kind = /^[a-f0-9]{40}$/.test(change.revision) ? 'commit/' : 'releases/tag/';
    const issue = await api(repositoryPath(repository) + '/issues', {
      method: 'POST',
      body: {
        title: `[Spec review] ${change.feed} ${change.channel}: ${change.revision}`,
        body: `${change.marker}\n\nUpstream revision changed from ${change.previous ?? '(untracked)'} to ${change.revision}.\n\n`
          + `Source: https://github.com/${change.repository}/${kind}${encodeURIComponent(change.revision)}\n\n`
          + `Current specification identity: ${change.specRevision}.\n\n`
          + 'Review spec/API differences, independent target evidence, compatibility and versioning. '
          + 'Add a new immutable specification identity when required. The release-policy gate requires a merged, '
          + 'maintainer-approved exact revision. This notification changes no pins or capability status; preview '
          + 'opt-in remains mandatory and unknown/unsupported targets remain unqualified.',
      },
    });
    change.issue = issue.number;
    issues.push(issue);
  }
  return { schemaVersion: 1, changes, wroteIssues: writeIssues, promotedCapabilities: [] };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { 'write-issues': { type: 'boolean', default: false } } });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const result = await watch({
    feeds: await policyJSON('feeds.json'), api: github({ signal: controller.signal }),
    repository: process.env.GITHUB_REPOSITORY, writeIssues: values['write-issues'], signal: controller.signal,
  });
  console.log(JSON.stringify(result, null, 2));
}
