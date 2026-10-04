import { GitError } from '../errors.js';
import { apiQuery, providerNumber, providerText } from './endpoints.js';
import { issueInput, issueRecord, pullRequestInput, pullRequestRecord, textPatch } from './models.js';

/** Gitea's v1 API; every self-hosted server remains subject to an explicit origin grant. */
export class GiteaProvider {
  constructor({ client, endpoint }) { this.client = client; this.endpoint = endpoint; this.provider = 'gitea'; }
  path(suffix = '') { return `${this.endpoint.repoPath}${suffix}`; }

  async getPullRequest(number, options = {}) {
    return pullRequestRecord(await this.client.json(this.path(`/pulls/${providerNumber(number)}`), options), this.provider);
  }

  async listPullRequests({ state = 'open', signal } = {}) {
    return (await this.client.paginate(apiQuery(this.path('/pulls'), { state, limit: 50 }), { signal }))
      .map(value => pullRequestRecord(value, this.provider));
  }

  async createPullRequest(input, options = {}) {
    const request = pullRequestInput(input);
    if (request.draft && !request.title.startsWith('[WIP]')) request.title = `[WIP] ${request.title}`;
    delete request.draft;
    return pullRequestRecord(await this.client.json(this.path('/pulls'), {
      ...options, method: 'POST', body: request, operation: 'pullRequest'
    }), this.provider);
  }

  async updatePullRequest(number, input, options = {}) {
    return pullRequestRecord(await this.client.json(this.path(`/pulls/${providerNumber(number)}`), {
      ...options, method: 'PATCH', body: textPatch(input, { title: 'title', body: 'body', state: 'state', base: 'base' }), operation: 'pullRequest'
    }), this.provider);
  }

  async listIssues({ state = 'open', signal } = {}) {
    return (await this.client.paginate(apiQuery(this.path('/issues'), { state, type: 'issues', limit: 50 }), { signal }))
      .map(value => issueRecord(value, this.provider));
  }

  async createIssue(input, options = {}) {
    return issueRecord(await this.client.json(this.path('/issues'), {
      ...options, method: 'POST', body: issueInput(input), operation: 'issue'
    }), this.provider);
  }

  async updateIssue(number, input, options = {}) {
    return issueRecord(await this.client.json(this.path(`/issues/${providerNumber(number)}`), {
      ...options, method: 'PATCH', body: textPatch(input, { title: 'title', body: 'body', state: 'state' }), operation: 'issue'
    }), this.provider);
  }

  listComments(number, { signal } = {}) {
    return this.client.paginate(this.path(`/issues/${providerNumber(number)}/comments?limit=50`), { signal });
  }

  addComment(number, body, options = {}) {
    return this.client.json(this.path(`/issues/${providerNumber(number)}/comments`), {
      ...options, method: 'POST', body: { body: providerText(body) }, operation: options.kind === 'issue' ? 'issue' : 'pullRequest'
    });
  }

  async listReviewThreads(number, { signal } = {}) {
    const reviews = await this.client.paginate(this.path(`/pulls/${providerNumber(number)}/reviews?limit=50`), { signal });
    const result = [];
    for (const review of reviews) {
      result.push({ ...review, comments: await this.client.paginate(
        this.path(`/pulls/${providerNumber(number)}/reviews/${providerNumber(review.id)}/comments?limit=50`), { signal }
      ) });
    }
    return result;
  }

  createReview(number, { body = '', event = 'COMMENT' }, options = {}) {
    const events = { COMMENT: 'COMMENT', APPROVE: 'APPROVED', REQUEST_CHANGES: 'REQUEST_CHANGES' };
    if (!events[event]) throw new GitError('Unsafe', 'Invalid review event');
    return this.client.json(this.path(`/pulls/${providerNumber(number)}/reviews`), {
      ...options, method: 'POST', body: { body: providerText(body), event: events[event] }, operation: 'pullRequest'
    });
  }

  async listChecks(sha, { signal } = {}) {
    const result = await this.client.json(this.path(`/commits/${encodeURIComponent(providerText(sha))}/status`), { signal });
    return { checks: result.statuses ?? [], statuses: result.statuses ?? [], state: result.state };
  }
}
