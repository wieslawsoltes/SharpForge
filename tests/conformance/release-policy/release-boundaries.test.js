import test from 'node:test';
import assert from 'node:assert/strict';
import { requireEnvironment, protectedEnvironment } from '../../../scripts/conformance/release-policy/environment.js';
import { exactDraftAssets } from '../../../scripts/conformance/release-policy/release-assets.js';
import { authorizedWorkflow } from '../../../scripts/conformance/release-policy/release.js';
import { requireReview } from '../../../scripts/conformance/release-policy/review.js';
import { sha256 } from '../../../scripts/conformance/release-policy/data.js';

const environment = {
  id: 42, name: 'release', can_admins_bypass: false,
  protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { id: 7 } }] }],
};

test('publication needs real protected environment configuration and independent recorded approval', async () => {
  const approval = { state: 'approved', user: { login: 'maintainer', type: 'User' }, environments: [{ id: 42 }] };
  const api = async (path) => path.endsWith('/approvals') ? [approval] : environment;
  const result = await requireEnvironment({ api, repository: 'owned/fixture', runId: 12, actor: 'author', requireApproval: true });
  assert.equal(result.approvalVerified, true);
  for (const value of [
    { ...environment, can_admins_bypass: true },
    { ...environment, protection_rules: [] },
    { ...environment, protection_rules: [{ ...environment.protection_rules[0], prevent_self_review: false }] },
  ]) assert.throws(() => protectedEnvironment(value), /requires reviewers/);
  await assert.rejects(requireEnvironment({ api, repository: 'owned/fixture', runId: 12, actor: 'maintainer', requireApproval: true }), /independent/);
  await assert.rejects(requireEnvironment({ api: async (path) => path.endsWith('/approvals') ? [] : environment,
    repository: 'owned/fixture', runId: 12, actor: 'author', requireApproval: true }), /independent/);
});

test('draft asset gate rejects published releases, incomplete sets and altered or missing remote digests', () => {
  const files = [{ path: 'artifacts/SBOM.cdx.json', bytes: 2, sha256: 'a'.repeat(64) }];
  const identity = { tag: 'v1.2.3', commit: 'b'.repeat(40), prerelease: false };
  const draft = { id: 1, draft: true, tag_name: identity.tag, target_commitish: identity.commit, prerelease: false,
    assets: [{ name: 'SBOM.cdx.json', state: 'uploaded', size: 2, digest: 'sha256:' + 'a'.repeat(64) }] };
  assert.equal(exactDraftAssets(draft, files, identity), draft);
  for (const altered of [
    { ...draft, draft: false }, { ...draft, assets: [] }, { ...draft, prerelease: true },
    { ...draft, assets: [{ ...draft.assets[0], digest: null }] },
    { ...draft, assets: [{ ...draft.assets[0], digest: 'sha256:' + 'c'.repeat(64) }] },
    { ...draft, assets: [...draft.assets, ...draft.assets] },
  ]) assert.throws(() => exactDraftAssets(altered, files, identity));
});

test('release mutation API refuses non-tag, local and pull request workflows', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.2.3',
    GITHUB_REF_NAME: 'v1.2.3', GITHUB_RUN_ID: '12' };
  authorizedWorkflow(env);
  assert.throws(() => authorizedWorkflow({}), /authorized tag/);
  assert.throws(() => authorizedWorkflow({ ...env, GITHUB_EVENT_NAME: 'pull_request' }), /authorized tag/);
  assert.throws(() => authorizedWorkflow({ ...env, GITHUB_REF: 'refs/heads/main' }), /authorized tag/);
});

test('spec review binds the merged PR, exact input content, exact review commit and a distinct maintainer', async () => {
  const reviewedCommit = 'a'.repeat(40);
  const bytes = Buffer.from('owned changed input');
  const changes = [{ path: 'planning/contracts/spec-revisions.json', after: sha256(bytes) }];
  const request = { pullRequest: 1, reviewedCommit };
  const pull = { merged_at: '2026-10-03T12:00:00Z', base: { ref: 'main', repo: { full_name: 'owned/fixture' } },
    head: { sha: reviewedCommit }, user: { login: 'author' } };
  const reviews = [{ id: 1, user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: reviewedCommit }];
  const api = async (path) => {
    if (path.includes('/contents/')) return { type: 'file', encoding: 'base64', content: bytes.toString('base64') };
    if (path.includes('/reviews?')) return reviews;
    if (path.includes('/permission')) return { permission: 'admin' };
    return pull;
  };
  assert.equal((await requireReview({ api, repository: 'owned/fixture', request, changes })).reviewer, 'reviewer');
  reviews[0].commit_id = 'b'.repeat(40);
  await assert.rejects(requireReview({ api, repository: 'owned/fixture', request, changes }), /maintainer approval/);
  reviews[0].commit_id = reviewedCommit;
  reviews.push({ ...reviews[0], id: 2, state: 'CHANGES_REQUESTED' });
  await assert.rejects(requireReview({ api, repository: 'owned/fixture', request, changes }), /maintainer approval/);
  reviews.pop();
  await assert.rejects(requireReview({ api, repository: 'owned/fixture', request, changes: [{ ...changes[0], after: 'c'.repeat(64) }] }), /exact policy input/);
  pull.merged_at = null;
  await assert.rejects(requireReview({ api, repository: 'owned/fixture', request, changes }), /merged main PR/);
});
