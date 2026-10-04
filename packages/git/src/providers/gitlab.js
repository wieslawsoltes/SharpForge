import { GitError } from '../errors.js';
import { apiQuery, providerNumber, providerText } from './endpoints.js';
import { issueInput, issueRecord, pullRequestInput, pullRequestRecord, textPatch } from './models.js';

/** GitLab.com and explicitly granted self-managed GitLab MRs, discussions, notes, issues and pipelines. */
export class GitLabProvider {
  constructor({ client, endpoint }) { this.client = client; this.endpoint = endpoint; this.provider = 'gitlab'; }
  path(suffix = '') { return `${this.endpoint.repoPath}${suffix}`; }

  async getPullRequest(number, options = {}) {
    const value = await this.client.json(this.path(`/merge_requests/${providerNumber(number)}`), options);
    // A fork's source project can differ from the target. Resolve its documented clone URL independently.
    const source = value.source_project_id ? await this.client.json(`projects/${providerNumber(value.source_project_id)}`, options) : null;
    return pullRequestRecord(value, this.provider, { sourceRemote: source?.http_url_to_repo });
  }

  async listPullRequests({ state = 'open', signal } = {}) {
    const states = { open: 'opened', closed: 'closed', all: 'all', merged: 'merged' };
    return (await this.client.paginate(apiQuery(this.path('/merge_requests'), { state: states[state] ?? state, per_page: 100 }), { signal }))
      .map(value => pullRequestRecord(value, this.provider));
  }

  async createPullRequest(input, options = {}) {
    const request = pullRequestInput(input);
    const body = { title: request.draft ? `Draft: ${request.title}` : request.title, description: request.body,
      source_branch: request.head, target_branch: request.base };
    return pullRequestRecord(await this.client.json(this.path('/merge_requests'), {
      ...options, method: 'POST', body, operation: 'pullRequest'
    }), this.provider);
  }

  async updatePullRequest(number, input, options = {}) {
    const body = textPatch(input, { title: 'title', body: 'description', base: 'target_branch' });
    if (input.state !== undefined) body.state_event = input.state === 'closed' ? 'close' : 'reopen';
    return pullRequestRecord(await this.client.json(this.path(`/merge_requests/${providerNumber(number)}`), {
      ...options, method: 'PUT', body, operation: 'pullRequest'
    }), this.provider);
  }

  async listIssues({ state = 'open', signal } = {}) {
    return (await this.client.paginate(apiQuery(this.path('/issues'), { state: state === 'open' ? 'opened' : state, per_page: 100 }), { signal }))
      .map(value => issueRecord(value, this.provider));
  }

  async createIssue(input, options = {}) {
    const { title, body } = issueInput(input);
    return issueRecord(await this.client.json(this.path('/issues'), {
      ...options, method: 'POST', body: { title, description: body }, operation: 'issue'
    }), this.provider);
  }

  async updateIssue(number, input, options = {}) {
    const body = textPatch(input, { title: 'title', body: 'description' });
    if (input.state !== undefined) body.state_event = input.state === 'closed' ? 'close' : 'reopen';
    return issueRecord(await this.client.json(this.path(`/issues/${providerNumber(number)}`), {
      ...options, method: 'PUT', body, operation: 'issue'
    }), this.provider);
  }

  listComments(number, { kind = 'pullRequest', signal } = {}) {
    return this.client.paginate(this.path(`/${kind === 'issue' ? 'issues' : 'merge_requests'}/${providerNumber(number)}/notes?per_page=100`), { signal });
  }

  addComment(number, body, { kind = 'pullRequest', ...options } = {}) {
    return this.client.json(this.path(`/${kind === 'issue' ? 'issues' : 'merge_requests'}/${providerNumber(number)}/notes`), {
      ...options, method: 'POST', body: { body: providerText(body) }, operation: kind
    });
  }

  listReviewThreads(number, { signal } = {}) {
    return this.client.paginate(this.path(`/merge_requests/${providerNumber(number)}/discussions?per_page=100`), { signal });
  }

  createReview(number, { body = '', event = 'COMMENT' }, options = {}) {
    if (event === 'COMMENT') return this.addComment(number, body, options);
    if (event !== 'APPROVE') throw new GitError('Unsupported', 'GitLab change requests use review discussions');
    return this.client.json(this.path(`/merge_requests/${providerNumber(number)}/approve`), {
      ...options, method: 'POST', body: {}, operation: 'pullRequest'
    });
  }

  async listChecks(sha, { signal } = {}) {
    const checks = await this.client.paginate(apiQuery(this.path('/pipelines'), { sha: providerText(sha, 'Commit', 128), per_page: 100 }), { signal });
    return { checks, statuses: checks, state: checks[0]?.status ?? 'unknown' };
  }
}
