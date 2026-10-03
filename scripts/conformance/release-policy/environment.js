import { parseArgs } from 'node:util';
import { isMain } from '../supply/files.js';
import { github, repositoryPath } from './github.js';

export function protectedEnvironment(value) {
  const reviewers = value?.protection_rules?.filter((rule) => rule.type === 'required_reviewers') ?? [];
  if (!Number.isSafeInteger(value?.id) || value.name !== 'release' || reviewers.length !== 1
      || reviewers[0].prevent_self_review !== true || !Array.isArray(reviewers[0].reviewers)
      || !reviewers[0].reviewers.length || value.can_admins_bypass !== false) {
    throw new Error('Release environment requires reviewers, prevented self-review and disabled administrator bypass');
  }
  return value;
}

export async function requireEnvironment({ api, repository, runId, actor, requireApproval = false } = {}) {
  const prefix = repositoryPath(repository);
  const environment = protectedEnvironment(await api(prefix + '/environments/release'));
  if (requireApproval) {
    if (!/^\d+$/.test(String(runId)) || !actor) throw new Error('Release approval needs exact workflow run and actor');
    const history = await api(`${prefix}/actions/runs/${runId}/approvals`);
    if (!Array.isArray(history) || history.length > 1000) throw new Error('Missing or oversized environment approval history');
    const decisions = history.filter((item) => item.environments?.some((env) => env.id === environment.id));
    if (!decisions.length || !decisions.every((item) => item.state === 'approved')
        || !decisions.some((item) => item.user?.login && item.user.login !== actor && item.user.type === 'User')) {
      throw new Error('No independent recorded approval for the release environment in this run');
    }
  }
  return { environment: environment.name, id: environment.id, requiredReview: true, approvalVerified: requireApproval };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { 'require-approval': { type: 'boolean', default: false } } });
  console.log(JSON.stringify(await requireEnvironment({
    api: github(), repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID,
    actor: process.env.GITHUB_ACTOR, requireApproval: values['require-approval'],
  })));
}
