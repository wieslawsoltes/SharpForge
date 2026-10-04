import { parseArgs } from 'node:util';
import { GitHubProject } from './lib/github-project.js';
import { parseDependencies, WORK_ID } from './lib/deps-parse.js';
import { isMain, writeJSON } from './lib/io.js';

function metadataField(body, name) {
  // Metadata precedes the deliverable/dependency sections. Release tasks put
  // several fields on one line; legacy tasks bold the field label instead.
  const header = body.split(/^##[ \t]/m, 1)[0];
  const value = header.match(new RegExp(`(?:^|[.·][ \\t]+)[ \\t]*(?:\\*\\*)?${name}:(?:\\*\\*)?[ \\t]*([^\\r\\n]*)`, 'm'))?.[1];
  return value?.split(/[ \t]+·[ \t]+|\.[ \t]+(?=(?:\*\*)?[A-Z][\w ]*:)/, 1)[0] ?? '';
}

export function normalizeSnapshot({ issues, items = [], defaultBranch = 'main', repository, updatedAt = new Date().toISOString() }) {
  const issueIds = new Map(issues.map(i => [i.number, i.title.match(/^\[([^\]]+)\]/)?.[1]]));
  const normalized = [];
  for (const issue of issues) {
    const id = issueIds.get(issue.number); if (!WORK_ID.test(id ?? '')) continue;
    const body = issue.body ?? '', deps = parseDependencies(body);
    const parentField = metadataField(body, 'Parent');
    const parentNumber = Number(parentField.match(/(?:issues\/|#)(\d+)/)?.[1]);
    const parentName = parentField.match(/^(?:\*\*)?\[(SF-[^\]]+)\]/)?.[1];
    const parent = parentName && WORK_ID.test(parentName) ? parentName : issueIds.get(parentNumber);
    const declaredArea = metadataField(body, 'Area').match(/^(?:\*\*)?(A\d{2})(?:\*\*)?(?=[ \t.·]|$)/)?.[1];
    const area = id.match(/^SF-(A\d{2})-/)?.[1] ?? declaredArea ?? id.match(/^SF-(R\d{3})-/)?.[1];
    const item = items.find(i => i.content?.number === issue.number);
    normalized.push({ id, number: issue.number, title: issue.title, body, state: issue.state.toUpperCase(), area, kind: /-E\d/.test(id) ? 'Epic' : /\.\d+$/.test(id) ? 'Sub-task' : /-B\d/.test(id) ? 'Bug' : 'Task', parent: WORK_ID.test(parent ?? '') ? parent : null, ...deps, labels: (issue.labels?.nodes ?? issue.labels ?? []).map(l => typeof l === 'string' ? l : l.name).sort(), project: item?.fields ?? {}, pullRequests: (issue.closedByPullRequestsReferences?.nodes ?? issue.pullRequests ?? []).map(pr => ({ number: pr.number, merged: pr.merged === true, mergedAt: pr.mergedAt ?? null, mergeCommit: pr.mergeCommit?.oid ?? pr.mergeCommit ?? null, head: pr.headRefOid ?? null, baseRefName: pr.baseRefName })).sort((a, b) => a.number - b.number) });
  }
  return { version: 1, repository, defaultBranch, updatedAt, issues: normalized.sort((a, b) => a.id.localeCompare(b.id)) };
}
export async function snapshotBacklog(client) {
  const items = await client.items(), issues = []; let after = null, defaultBranch;
  do {
    const data = await client.graphql('query Backlog($owner:String!,$repo:String!,$after:String){repository(owner:$owner,name:$repo){defaultBranchRef{name} issues(first:50,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){nodes{number title body state labels(first:100){nodes{name}} closedByPullRequestsReferences(first:20){nodes{number merged mergedAt mergeCommit{oid} headRefOid baseRefName} pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}}}', { owner: client.owner, repo: client.repo, after });
    defaultBranch = data.repository.defaultBranchRef.name;
    for (const issue of data.repository.issues.nodes) {
      if (issue.closedByPullRequestsReferences.pageInfo.hasNextPage) throw new Error(`Issue #${issue.number} has >20 closing PRs; expand query before recording complete evidence`);
      issues.push(issue);
    }
    after = data.repository.issues.pageInfo.hasNextPage ? data.repository.issues.pageInfo.endCursor : null;
  } while (after);
  return normalizeSnapshot({ issues, items, defaultBranch, repository: `${client.owner}/${client.repo}` });
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { owner: { type: 'string', default: 'wieslawsoltes' }, repo: { type: 'string', default: 'SharpForge' }, project: { type: 'string', default: '4' }, output: { type: 'string', default: 'planning/backlog.snapshot.json' } } });
  const snapshot = await snapshotBacklog(new GitHubProject({ ...values, number: values.project })); writeJSON(values.output, snapshot); console.log(`Captured ${snapshot.issues.length} work items`);
}
