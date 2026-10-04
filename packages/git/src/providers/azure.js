import { GitError } from '../errors.js';
import { apiQuery, providerNumber, providerText } from './endpoints.js';
import { issueInput, issueRecord, pullRequestInput, pullRequestRecord } from './models.js';

/** Azure DevOps 7.1 PRs, threads, statuses and work items, using project-scoped REST roots. */
export class AzureDevOpsProvider {
  constructor({ client, endpoint }) { this.client = client; this.endpoint = endpoint; this.provider = 'azure'; }
  path(suffix = '', query = {}) { return apiQuery(`${this.endpoint.repoPath}${suffix}`, { 'api-version': '7.1', ...query }); }

  async getPullRequest(number, options = {}) {
    return pullRequestRecord(await this.client.json(this.path(`/pullrequests/${providerNumber(number)}`), options), this.provider, this.endpoint);
  }

  async listPullRequests({ state = 'open', signal } = {}) {
    const states = { open: 'active', closed: 'abandoned', merged: 'completed', all: 'all' };
    const values = await this.client.paginate(this.path('/pullrequests', { 'searchCriteria.status': states[state] ?? state, $top: 100 }), { signal });
    return values.map(value => pullRequestRecord(value, this.provider, this.endpoint));
  }

  async createPullRequest(input, options = {}) {
    const request = pullRequestInput(input);
    const branch = value => value.startsWith('refs/') ? value : `refs/heads/${value}`;
    return pullRequestRecord(await this.client.json(this.path('/pullrequests'), { ...options, method: 'POST', operation: 'pullRequest',
      body: { title: request.title, description: request.body, sourceRefName: branch(request.head),
        targetRefName: branch(request.base), isDraft: request.draft } }), this.provider, this.endpoint);
  }

  async updatePullRequest(number, input, options = {}) {
    const body = {};
    if (input.title !== undefined) body.title = providerText(input.title);
    if (input.body !== undefined) body.description = providerText(input.body);
    if (input.state !== undefined) body.status = input.state === 'closed' ? 'abandoned' : 'active';
    if (input.draft !== undefined) body.isDraft = Boolean(input.draft);
    return pullRequestRecord(await this.client.json(this.path(`/pullrequests/${providerNumber(number)}`), {
      ...options, method: 'PATCH', body, operation: 'pullRequest'
    }), this.provider, this.endpoint);
  }

  async listIssues({ signal, state } = {}) {
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project` +
      (state === 'closed' ? ` AND [System.State] = 'Closed'` : '') + ' ORDER BY [System.ChangedDate] DESC';
    const result = await this.client.json('wit/wiql?api-version=7.1&$top=1000', {
      method: 'POST', readOnly: true, queryKind: 'wiql', body: { query }, signal
    });
    const ids = (result.workItems ?? []).map(value => providerNumber(value.id));
    const values = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
      const page = await this.client.json(apiQuery('wit/workitems', { ids: ids.slice(offset, offset + 200).join(','), 'api-version': '7.1' }), { signal });
      values.push(...(page.value ?? []));
    }
    return values.map(value => issueRecord(value, this.provider));
  }

  async createIssue(input, options = {}) {
    const { title, body } = issueInput(input);
    return issueRecord(await this.client.json('wit/workitems/$Issue?api-version=7.1', {
      ...options, method: 'POST', operation: 'issue', headers: { 'Content-Type': 'application/json-patch+json' },
      body: [{ op: 'add', path: '/fields/System.Title', value: title }, { op: 'add', path: '/fields/System.Description', value: body }]
    }), this.provider);
  }

  async updateIssue(number, input, options = {}) {
    const body = [];
    for (const [key, field] of Object.entries({ title: 'System.Title', body: 'System.Description', state: 'System.State' })) {
      if (input[key] !== undefined) body.push({ op: 'add', path: `/fields/${field}`, value: providerText(input[key]) });
    }
    return issueRecord(await this.client.json(`wit/workitems/${providerNumber(number)}?api-version=7.1`, {
      ...options, method: 'PATCH', body, operation: 'issue', headers: { 'Content-Type': 'application/json-patch+json' }
    }), this.provider);
  }

  listComments(number, { kind = 'pullRequest', signal } = {}) {
    const path = kind === 'issue' ? `wit/workitems/${providerNumber(number)}/comments?api-version=7.1-preview.4` :
      this.path(`/pullrequests/${providerNumber(number)}/threads`);
    return this.client.paginate(path, { signal, select: value => value.comments ?? value.value });
  }

  addComment(number, body, { kind = 'pullRequest', ...options } = {}) {
    const text = providerText(body);
    if (kind === 'issue') return this.client.json(`wit/workitems/${providerNumber(number)}/comments?api-version=7.1-preview.4`, {
      ...options, method: 'POST', body: { text }, operation: 'issue'
    });
    return this.client.json(this.path(`/pullrequests/${providerNumber(number)}/threads`), {
      ...options, method: 'POST', body: { comments: [{ parentCommentId: 0, content: text, commentType: 1 }], status: 1 }, operation: 'pullRequest'
    });
  }

  async listReviewThreads(number, { signal } = {}) {
    const path = `/pullrequests/${providerNumber(number)}`;
    const iterations = await this.client.paginate(this.path(`${path}/iterations`), { signal });
    const latest = iterations.reduce((result, iteration) => !result || iteration.id > result.id ? iteration : result, null);
    const threads = await this.client.paginate(this.path(`${path}/threads`, latest ? { $iteration: providerNumber(latest.id) } : {}), { signal });
    return threads.map(thread => ({ ...thread, reviewedHeadOid: latest?.sourceRefCommit?.commitId,
      reviewedIteration: latest?.id }));
  }

  createReview(number, { body = '', event = 'COMMENT', reviewerId }, options = {}) {
    if (event === 'COMMENT') return this.addComment(number, body, options);
    const votes = { APPROVE: 10, REQUEST_CHANGES: -10 };
    if (!Object.hasOwn(votes, event) || !reviewerId) throw new GitError('Unsafe', 'Azure review vote requires a reviewer identity');
    return this.client.json(this.path(`/pullrequests/${providerNumber(number)}/reviewers/${encodeURIComponent(reviewerId)}`), {
      ...options, method: 'PUT', body: { vote: votes[event], id: reviewerId }, operation: 'pullRequest'
    });
  }

  async listChecks(sha, { signal } = {}) {
    const checks = await this.client.paginate(this.path(`/commits/${encodeURIComponent(providerText(sha))}/statuses`), { signal });
    return { checks, statuses: checks, state: checks[0]?.state ?? 'unknown' };
  }
}
