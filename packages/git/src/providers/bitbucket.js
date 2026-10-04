import { GitError } from '../errors.js';
import { apiQuery, providerNumber, providerText } from './endpoints.js';
import { issueInput, issueRecord, pullRequestInput, pullRequestRecord } from './models.js';

/** Bitbucket Cloud PR, review, issue and commit-status endpoint contracts. */
export class BitbucketProvider {
  constructor({ client, endpoint }) { this.client = client; this.endpoint = endpoint; this.provider = 'bitbucket'; }
  path(suffix = '') { return `${this.endpoint.repoPath}${suffix}`; }

  async getPullRequest(number, options = {}) {
    return pullRequestRecord(await this.client.json(this.path(`/pullrequests/${providerNumber(number)}`), options), this.provider);
  }

  async listPullRequests({ state = 'open', signal } = {}) {
    const states = { open: 'OPEN', closed: 'DECLINED', merged: 'MERGED', all: undefined };
    const query = apiQuery(this.path('/pullrequests'), { state: states[state], pagelen: 100 }) +
      (state === 'all' ? '&state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED' : '');
    return (await this.client.paginate(query, { signal }))
      .map(value => pullRequestRecord(value, this.provider));
  }

  async createPullRequest(input, options = {}) {
    const request = pullRequestInput(input);
    return pullRequestRecord(await this.client.json(this.path('/pullrequests'), { ...options, method: 'POST', operation: 'pullRequest',
      body: { title: request.title, description: request.body, source: { branch: { name: request.head } },
        destination: { branch: { name: request.base } }, draft: request.draft } }), this.provider);
  }

  async updatePullRequest(number, input, options = {}) {
    const path = this.path(`/pullrequests/${providerNumber(number)}`);
    if (input.state === 'closed') return pullRequestRecord(await this.client.json(`${path}/decline`, {
      ...options, method: 'POST', body: {}, operation: 'pullRequest'
    }), this.provider);
    const body = {};
    if (input.title !== undefined) body.title = providerText(input.title);
    if (input.body !== undefined) body.description = providerText(input.body);
    if (input.base !== undefined) body.destination = { branch: { name: providerText(input.base) } };
    return pullRequestRecord(await this.client.json(path, { ...options, method: 'PUT', body, operation: 'pullRequest' }), this.provider);
  }

  async listIssues({ signal } = {}) {
    return (await this.client.paginate(this.path('/issues?pagelen=100'), { signal })).map(value => issueRecord(value, this.provider));
  }

  async createIssue(input, options = {}) {
    const { title, body } = issueInput(input);
    return issueRecord(await this.client.json(this.path('/issues'), { ...options, method: 'POST', operation: 'issue',
      body: { title, content: { raw: body } } }), this.provider);
  }

  async updateIssue(number, input, options = {}) {
    const body = {};
    if (input.title !== undefined) body.title = providerText(input.title);
    if (input.body !== undefined) body.content = { raw: providerText(input.body) };
    if (input.state !== undefined) body.state = input.state === 'closed' ? 'resolved' : 'open';
    return issueRecord(await this.client.json(this.path(`/issues/${providerNumber(number)}`), {
      ...options, method: 'PUT', body, operation: 'issue'
    }), this.provider);
  }

  listComments(number, { kind = 'pullRequest', signal } = {}) {
    return this.client.paginate(this.path(`/${kind === 'issue' ? 'issues' : 'pullrequests'}/${providerNumber(number)}/comments?pagelen=100`), { signal });
  }

  addComment(number, body, { kind = 'pullRequest', ...options } = {}) {
    return this.client.json(this.path(`/${kind === 'issue' ? 'issues' : 'pullrequests'}/${providerNumber(number)}/comments`), {
      ...options, method: 'POST', body: { content: { raw: providerText(body) } }, operation: kind
    });
  }

  listReviewThreads(number, options) { return this.listComments(number, options); }

  createReview(number, { body = '', event = 'COMMENT' }, options = {}) {
    if (event === 'COMMENT') return this.addComment(number, body, options);
    if (event !== 'APPROVE') throw new GitError('Unsupported', 'Bitbucket requested changes use PR comments');
    return this.client.json(this.path(`/pullrequests/${providerNumber(number)}/approve`), {
      ...options, method: 'POST', body: {}, operation: 'pullRequest'
    });
  }

  async listChecks(sha, { signal } = {}) {
    const checks = await this.client.paginate(this.path(`/commit/${encodeURIComponent(providerText(sha))}/statuses?pagelen=100`), { signal });
    return { checks, statuses: checks, state: checks[0]?.state ?? 'unknown' };
  }
}
