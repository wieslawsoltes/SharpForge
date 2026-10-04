import { resolveTask } from '../../planning/lib/task-ref.js';
import { claimedIdentity } from './claim-identity.js';

const query = `query ClaimProjects($owner:String!,$repo:String!,$issue:Int!,$after:String) {
  repository(owner:$owner,name:$repo) { issue(number:$issue) {
    number title repository { nameWithOwner }
    projectItems(first:50,after:$after,includeArchived:false) {
      nodes {
        id isArchived
        project { id number url owner { ... on User { login } ... on Organization { login } } }
        workId:fieldValueByName(name:"Work ID") { ... on ProjectV2ItemFieldTextValue { text } }
        branch:fieldValueByName(name:"Branch") { ... on ProjectV2ItemFieldTextValue { text } }
        agent:fieldValueByName(name:"Agent") { ... on ProjectV2ItemFieldTextValue { text } }
      }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

/** Read only the claimed issue's live memberships, never a hard-coded Project board. */
export async function claimProjectItems(client, claim) {
  if (!Number.isSafeInteger(claim.issue) || claim.issue <= 0) throw new Error('Authoritative claim requires a valid issue number');
  const repository = `${client.owner}/${client.repo}`, items = [], seen = new Set(), cursors = new Set();
  let after = null;
  for (let page = 0; page < 10; page++) {
    const response = await client.graphql(query, { owner: client.owner, repo: client.repo, issue: claim.issue, after });
    const issue = response?.repository?.issue;
    if (issue?.number !== claim.issue || issue.repository?.nameWithOwner !== repository ||
        typeof issue.title !== 'string' || !issue.title.startsWith(`[${claim.task}]`)) {
      throw new Error('Claim issue identity, repository or task does not match live Project lookup');
    }
    const connection = issue.projectItems;
    if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('Missing live Project memberships for the claimed issue');
    }
    for (const item of connection.nodes) {
      if (!item?.id || seen.has(item.id)) throw new Error('Duplicate or missing Project item identity');
      seen.add(item.id);
      if (item.isArchived || item.project?.owner?.login !== client.owner) continue;
      // Tracking boards may carry a Work ID; only Agent/Branch make a claim projection.
      const workId = item.workId?.text, branch = item.branch?.text, agent = item.agent?.text;
      const populated = value => value !== undefined && value !== null && value !== '';
      if (!populated(agent) && !populated(branch)) continue;
      if (workId && workId !== claim.task) throw new Error('Project Work ID disagrees with the authoritative claim issue');
      if (typeof branch !== 'string' || !branch.trim()) throw new Error('Managed Project item requires a nonempty Branch');
      if (typeof agent !== 'string' || !agent.trim() || agent !== claim.agent) throw new Error('Managed Project Agent does not match the authoritative claim');
      if (branch !== claim.branch) throw new Error('Managed Project Branch does not match the authoritative claim');
      if (!item.project.id || !Number.isSafeInteger(item.project.number) || item.project.number <= 0) {
        throw new Error('Missing authoritative Project identity');
      }
      items.push({ id: item.id, content: { number: issue.number, title: issue.title, repository: issue.repository },
        fields: { 'Work ID': workId, Branch: branch, Agent: agent },
        project: { id: item.project.id, number: item.project.number, url: item.project.url, owner: item.project.owner.login } });
    }
    if (!connection.pageInfo.hasNextPage) return items;
    const cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new Error('Project membership pagination did not advance');
    cursors.add(cursor); after = cursor;
  }
  throw new Error('Project membership lookup exceeds the supported pagination bound');
}

/** Pin the claim snapshot once, then reuse the existing branch/lease/lock checks. */
export async function groupClaimedIdentity(client, pullRequest, now = Date.now()) {
  const task = resolveTask({ branch: pullRequest.head.ref, body: pullRequest.body ?? '' });
  const ref = await client.ref(`agent/${task}`);
  if (!ref) throw new Error(`Task ${task} has no authoritative claim`);
  const claim = await client.readRecord(ref.object.sha);
  if (claim.task !== task) throw new Error('Claim task does not match the constituent PR');
  const items = await claimProjectItems(client, claim);
  const pinned = Object.create(client);
  pinned.items = async () => items;
  pinned.ref = name => name === `agent/${task}` ? Promise.resolve(ref) : client.ref(name);
  pinned.readRecord = sha => sha === ref.object.sha ? Promise.resolve(claim) : client.readRecord(sha);
  const identity = await claimedIdentity(pinned, pullRequest, now);
  return { ...identity, project: items[0].project, issue: claim.issue };
}

// The same claim lookup applies to an individually dispatched PR.
export { groupClaimedIdentity as projectClaimedIdentity };
