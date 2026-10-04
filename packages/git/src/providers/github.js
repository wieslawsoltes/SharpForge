import { GitError, checkLimit } from '../errors.js';
import { apiQuery, providerNumber, providerText } from './endpoints.js';
import { issueInput, issueRecord, pullRequestInput, pullRequestRecord, textPatch } from './models.js';

/** GitHub REST PR/issues/checks plus GraphQL review thread pagination. */
export class GitHubProvider {
  constructor({ client, endpoint }) { this.client = client; this.endpoint = endpoint; this.provider = 'github'; }
  path(suffix = '') { return `${this.endpoint.repoPath}${suffix}`; }

  async getPullRequest(number, options = {}) {
    return pullRequestRecord(await this.client.json(this.path(`/pulls/${providerNumber(number)}`), options), this.provider);
  }

  async listPullRequests({ state = 'open', signal } = {}) {
    const values = await this.client.paginate(apiQuery(this.path('/pulls'), { state, per_page: 100 }), { signal });
    return values.map(value => pullRequestRecord(value, this.provider));
  }

  async createPullRequest(input, options = {}) {
    const body = pullRequestInput(input);
    return pullRequestRecord(await this.client.json(this.path('/pulls'), {
      ...options, method: 'POST', body, operation: 'pullRequest', description: `Create pull request: ${body.title}`
    }), this.provider);
  }

  async updatePullRequest(number, input, options = {}) {
    const body = textPatch(input, { title: 'title', body: 'body', base: 'base', state: 'state' });
    return pullRequestRecord(await this.client.json(this.path(`/pulls/${providerNumber(number)}`), {
      ...options, method: 'PATCH', body, operation: 'pullRequest'
    }), this.provider);
  }

  async listIssues({ state = 'open', signal } = {}) {
    const values = await this.client.paginate(apiQuery(this.path('/issues'), { state, per_page: 100 }), { signal });
    return values.filter(value => !value.pull_request).map(value => issueRecord(value, this.provider));
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
    return this.client.paginate(this.path(`/issues/${providerNumber(number)}/comments?per_page=100`), { signal });
  }

  addComment(number, body, options = {}) {
    return this.client.json(this.path(`/issues/${providerNumber(number)}/comments`), {
      ...options, method: 'POST', body: { body: providerText(body) }, operation: options.kind === 'issue' ? 'issue' : 'pullRequest'
    });
  }

  createReview(number, { body = '', event = 'COMMENT' }, options = {}) {
    if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) throw new GitError('Unsafe', 'Invalid review event');
    return this.client.json(this.path(`/pulls/${providerNumber(number)}/reviews`), {
      ...options, method: 'POST', body: { body: providerText(body), event }, operation: 'pullRequest'
    });
  }

  async listChecks(sha, { signal } = {}) {
    const commit = encodeURIComponent(providerText(sha, 'Commit', 128));
    const [checks, status] = await Promise.all([
      this.client.paginate(this.path(`/commits/${commit}/check-runs?per_page=100`), { signal, select: value => value.check_runs }),
      this.client.json(this.path(`/commits/${commit}/status`), { signal })
    ]);
    return { checks, statuses: status.statuses ?? [], state: status.state };
  }

  async listReviewThreads(number, { signal } = {}) {
    const query = `query ReviewThreads($owner:String!,$repo:String!,$number:Int!,$after:String) {
      repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
        reviewThreads(first:100,after:$after) { nodes { id isResolved isOutdated path line diffSide
          comments(first:100) { nodes { id body author { login } url } pageInfo { hasNextPage endCursor } }
        } pageInfo { hasNextPage endCursor } }
      } }
    }`;
    const threads = [];
    const cursors = new Set();
    let after = null;
    for (let page = 0; page < this.client.maximumPages; page++) {
      const result = await this.client.json('graphql', { method: 'POST', readOnly: true, signal,
        body: { query, variables: { owner: this.endpoint.owner, repo: this.endpoint.repository, number: providerNumber(number), after } } });
      if (result.errors?.length) throw new GitError('Auth', 'GitHub review thread query failed');
      const connection = result.data?.repository?.pullRequest?.reviewThreads;
      if (!connection) throw new GitError('NotFound', 'Pull request review threads not found');
      checkLimit(threads.length + connection.nodes.length, this.client.maximumItems, 'Review thread count');
      for (const thread of connection.nodes) {
        if (thread.comments.pageInfo.hasNextPage) await this.#remainingComments(thread, signal);
        threads.push(thread);
      }
      if (!connection.pageInfo.hasNextPage) return threads;
      after = connection.pageInfo.endCursor;
      if (!after || cursors.has(after)) throw new GitError('Corrupt', 'Review thread cursor repeated');
      cursors.add(after);
    }
    throw new GitError('Limit', 'Review thread pagination limit exceeded');
  }

  async #remainingComments(thread, signal) {
    const query = `query ThreadComments($id:ID!,$after:String) { node(id:$id) { ... on PullRequestReviewThread {
      comments(first:100,after:$after) { nodes { id body author { login } url } pageInfo { hasNextPage endCursor } }
    } } }`;
    const cursors = new Set();
    for (let page = 0; page < this.client.maximumPages && thread.comments.pageInfo.hasNextPage; page++) {
      const after = thread.comments.pageInfo.endCursor;
      if (!after || cursors.has(after)) throw new GitError('Corrupt', 'Review comment cursor repeated');
      cursors.add(after);
      const result = await this.client.json('graphql', { method: 'POST', readOnly: true, signal,
        body: { query, variables: { id: thread.id, after } } });
      if (result.errors?.length || !result.data?.node?.comments) throw new GitError('Auth', 'Review comment query failed');
      const next = result.data.node.comments;
      checkLimit(thread.comments.nodes.length + next.nodes.length, this.client.maximumItems, 'Review comment count');
      thread.comments.nodes.push(...next.nodes);
      thread.comments.pageInfo = next.pageInfo;
    }
    if (thread.comments.pageInfo.hasNextPage) throw new GitError('Limit', 'Review comment pagination limit exceeded');
  }
}
