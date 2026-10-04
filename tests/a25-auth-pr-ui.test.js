import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGitProviders } from '../apps/studio/git-provider-view.js';
import { rememberGitProviderCreation } from '../apps/studio/git-pull-requests.js';
import { fixtureDocument, fixtureDescendants } from './a25-auth-ui-fixture.js';

test('A25 provider UI creates from the current branch and retains the returned link when list refresh fails', async () => {
  const document = fixtureDocument();
  const element = document.createElement('section');
  const remote = 'https://github.com/acme/project';
  const remoteId = 'https://github.com';
  const url = `${remote}/pull/23`;
  const writes = [];
  let branch = 'feature';
  let refreshFails = true;
  const workbench = { repositoryId: 'repository', workspaceBound: true,
    providerSelection: { provider: 'github', remote }, credentialIds: new Map([[remoteId, 'account']]),
    host: { showPanel() {} },
    safe(action) { workbench.pending = Promise.resolve().then(action); return workbench.pending; },
    preferences: { model: { values: { defaultBranch: 'main' } }, grant: async () => {},
      auth: async () => [{ id: 'account', provider: 'github', scopes: ['repo'], allowedOrigins: ['https://github.com', 'https://api.github.com'] }] },
    async request(name, params) {
      if (name === 'head') return { ref: `refs/heads/${branch}`, oid: 'a'.repeat(40) };
      if (name === 'git.auth') return { state: 'known-sufficient', scopeState: 'known', scopeSource: 'oauth-header',
        operation: 'pullRequest', scopes: ['repo'], missingScopes: [] };
      assert.equal(name, 'git.provider');
      if (params.operation === 'createPullRequest') {
        writes.push(params);
        return { id: 23, title: '<script>text only</script>', body: 'Review', url };
      }
      assert.equal(params.operation, 'listPullRequests');
      if (refreshFails) throw new Error('Fixture list unavailable');
      return [];
    }
  };
  document.onShow = dialog => {
    if (dialog['aria-label'] === 'Review Git write permissions') {
      void fixtureDescendants(dialog).find(value => value.textContent === 'Confirm Write').dispatch('click');
    }
  };
  let dispose = await renderGitProviders(element, workbench);
  await fixtureDescendants(element).find(value => value.textContent === 'New Pull Request').dispatch('click');
  await workbench.pending;
  const dialog = document.elements.find(value => value.tag === 'dialog' && value.open);
  const fields = fixtureDescendants(dialog);
  assert.equal(fields.find(value => value.name === 'head').value, 'feature');
  fields.find(value => value.name === 'title').value = 'Review';
  await fields.find(value => value.tag === 'form').dispatch('submit');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].input.head, 'feature');
  assert.deepEqual(writes[0].writeConsent, { remoteId, scope: 'pullRequest', confirmed: true });
  assert.equal(element.textContent.includes('Submitted successfully.'), true);
  let anchor = fixtureDescendants(element).find(value => value.tag === 'a' && value.href === url);
  assert.equal(anchor.textContent, url);
  assert.equal(anchor.rel, 'noopener noreferrer');
  assert.equal(document.elements.some(value => value.tag === 'script'), false);
  dispose();
  dispose = await renderGitProviders(element, workbench);
  anchor = fixtureDescendants(element).find(value => value.tag === 'a' && value.href === url);
  assert.equal(anchor.textContent, url);
  refreshFails = false;
  await fixtureDescendants(element).find(value => value.textContent === 'New Pull Request').dispatch('click');
  await workbench.pending;
  const second = document.elements.find(value => value.tag === 'dialog' && value.open);
  branch = 'different';
  await fixtureDescendants(second).find(value => value.tag === 'form').dispatch('submit');
  assert.equal(writes.length, 1);
  assert.equal(second.textContent.includes('source must be the current local branch'), true);
  dispose();
});

test('A25 an unsafe returned creation link is omitted without turning a completed write into a retry prompt', () => {
  const workbench = {};
  const created = rememberGitProviderCreation(workbench, { remote: 'https://github.com/acme/project', provider: 'github' },
    'pullRequest', { id: 3, title: 'Created', url: 'javascript:alert(1)' });
  assert.equal(created.id, 3);
  assert.equal(created.url, null);
  assert.equal(workbench.lastProviderCreation, created);
});
