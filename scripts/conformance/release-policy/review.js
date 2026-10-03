import { repositoryPath, pages } from './github.js';
import { sha256 } from './data.js';

/** Review authorizations come from GitHub, never from an `approved: true` field in the checkout. */
export async function requireReview({ api, repository, request, changes, signal }) {
  const prefix = repositoryPath(repository);
  if (!Number.isSafeInteger(request?.pullRequest) || request.pullRequest < 1
      || !/^[a-f0-9]{40}$/.test(request.reviewedCommit ?? '')) throw new Error('Missing exact review request');
  const pull = await api(`${prefix}/pulls/${request.pullRequest}`);
  if (!pull.merged_at || pull.base?.ref !== 'main' || pull.base?.repo?.full_name !== repository
      || pull.head?.sha !== request.reviewedCommit) throw new Error('Policy changes require a merged main PR at the reviewed commit');
  for (const change of changes) {
    signal?.throwIfAborted();
    const path = change.path.split('/').map(encodeURIComponent).join('/');
    const file = await api(`${prefix}/contents/${path}?ref=${request.reviewedCommit}`);
    if (file.type !== 'file' || file.encoding !== 'base64'
        || sha256(Buffer.from(file.content, 'base64')) !== change.after) {
      throw new Error('Approved PR does not contain these exact policy input bytes');
    }
  }
  const reviews = await pages(api, `${prefix}/pulls/${request.pullRequest}/reviews`, { signal });
  const latest = new Map();
  if (reviews.some((review) => !Number.isSafeInteger(review.id))) throw new Error('Malformed review identity');
  for (const review of reviews.sort((a, b) => a.id - b.id)) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user?.login, review);
  }
  for (const [login, review] of latest) {
    if (!login || login === pull.user?.login || review.state !== 'APPROVED'
        || review.commit_id !== request.reviewedCommit || review.user?.type !== 'User') continue;
    const permissions = await api(`${prefix}/collaborators/${encodeURIComponent(login)}/permission`);
    if (permissions.permission === 'admin' || permissions.role_name === 'maintain') {
      return { pullRequest: request.pullRequest, reviewedCommit: request.reviewedCommit, reviewer: login };
    }
  }
  throw new Error('Policy promotion requires a distinct maintainer approval at the exact reviewed commit');
}
