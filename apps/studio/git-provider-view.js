import { gitElement, gitButton, gitField, gitDialog } from './git-dom.js';
import { providerTarget, providerAccounts, selectedProviderAccount, authorizeProviderTarget } from './git-provider-session.js';
import { requestGitWriteConsent } from './git-permissions.js';
import { currentGitPullRequestBranch, checkoutGitPullRequest, rememberGitProviderCreation } from './git-pull-requests.js';
import { readGitReview, annotateGitReviewFile } from './git-provider-annotations.js';

async function linked(signals, action) {
  const controller = new AbortController();
  const active = signals.filter(Boolean);
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try { return await action(controller.signal); }
  finally { for (const signal of active) signal.removeEventListener('abort', abort); }
}

/** Provider APIs return text and canonical links; remote content is never interpreted as HTML. */
export async function renderGitProviders(element, workbench) {
  const document = element.ownerDocument;
  const selection = workbench.providerSelection ?? { provider: 'github', remote: '' };
  const provider = gitElement(document, 'select', { 'aria-label': 'Git provider' },
    ...['github', 'gitlab', 'bitbucket', 'azure', 'gitea'].map(name => gitElement(document, 'option', { value: name, text: name })));
  provider.value = selection.provider;
  const remote = gitElement(document, 'input', { type: 'url', placeholder: 'https://github.com/owner/repository', value: selection.remote });
  const credential = gitElement(document, 'select', { 'aria-label': 'Signed-in account' });
  const list = gitElement(document, 'div', { className: 'git-provider-list', role: 'list' });
  const status = gitElement(document, 'p', { className: 'git-muted', role: 'status' });
  const created = gitElement(document, 'p', { role: 'status', 'aria-live': 'polite' });
  const reviews = gitElement(document, 'section', { 'aria-label': 'Pull request review comments' });
  let kind = 'pullRequest';
  let generation = 0;
  const controller = new AbortController();
  const target = () => ({ ...providerTarget(remote.value, provider.value), credentialId: credential.value });
  const accounts = async () => {
    credential.replaceChildren(gitElement(document, 'option', { value: '', text: 'Anonymous (public repositories)' }));
    if (!remote.value) return;
    const identity = providerTarget(remote.value, provider.value);
    const values = await providerAccounts(workbench, identity);
    for (const account of values) credential.append(gitElement(document, 'option', { value: account.id,
      text: `${account.id} · ${(account.scopes ?? []).join(', ') || 'Scopes unverified'}` }));
    credential.value = selectedProviderAccount(workbench, identity, values) ?? '';
  };
  const showCreated = () => {
    const item = workbench.lastProviderCreation;
    created.replaceChildren();
    if (!item) return;
    created.append(gitElement(document, 'span', { text: `Created ${item.kind === 'issue' ? 'issue' : 'pull request'} #${item.id} · ${item.title} ` }));
    if (item.url) created.append(gitElement(document, 'a', { href: item.url, target: '_blank', rel: 'noopener noreferrer',
      text: item.url, 'aria-label': 'Open newly created item in provider' }));
    else created.append(gitElement(document, 'span', { text: 'The provider did not return a safe link.' }));
  };
  const invoke = (identity, operation, input = {}, scope, options = {}) => linked([controller.signal, options.signal], async signal => {
    const authorized = await authorizeProviderTarget(workbench, identity, identity.credentialId, { signal });
    workbench.providerSelection = { provider: identity.provider, remote: identity.remote, credentialId: authorized.credentialId };
    const writeConsent = scope ? await requestGitWriteConsent(workbench, { ...authorized, operation: scope,
      document, signal, description: `Submit ${scope === 'issue' ? 'issue' : 'pull request'} changes` }) : undefined;
    return workbench.request('git.provider', { ...authorized, operation, input, writeConsent }, { signal });
  });
  const compose = (identity, title, fields, action, type = kind, creation = false) => gitDialog(document, {
    title: `${title} · ${new URL(identity.remote).pathname}`, fields, submitLabel: 'Submit',
    onSubmit: async (values, options) => {
      const result = await action(values, options);
      if (creation) { rememberGitProviderCreation(workbench, identity, type, result); showCreated(); }
      try { await load(type, identity, options); }
      catch (error) { status.textContent = `Submitted successfully. The list could not refresh: ${error.message}`; }
    }
  });
  const review = (identity, id) => {
    const events = identity.provider === 'gitlab' || identity.provider === 'bitbucket' ?
      ['COMMENT', 'APPROVE'] : ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];
    compose(identity, 'Review Pull Request', [
      { name: 'event', label: 'Decision', options: events.map(value => ({ value, label: value.replaceAll('_', ' ') })) },
      { name: 'body', label: 'Review', multiline: true },
      ...(identity.provider === 'azure' ? [{ name: 'reviewerId', label: 'Azure reviewer identity (required for approval or rejection)' }] : [])
    ], (values, options) => invoke(identity, 'createReview', { ...values, number: id }, 'pullRequest', options), 'pullRequest');
  };
  const checkout = (identity, id) => gitDialog(document, {
    title: `Check Out Pull Request #${id}`, submitLabel: 'Fetch and Check Out',
    fields: [{ name: 'branch', label: 'New local tracking branch', value: `pr/${identity.provider}-${id}`, required: true }],
    onSubmit: (values, options) => workbench.run(operation => linked([operation.signal, options.signal], signal =>
      checkoutGitPullRequest(workbench, identity, id, { ...operation, signal, branch: values.branch })), { workspace: true })
  });
  const showReview = async (identity, id) => {
    const result = await readGitReview(workbench, identity, id, { signal: controller.signal });
    let page = 0;
    const draw = () => {
      reviews.replaceChildren(gitElement(document, 'h3', { text: `Review comments · #${id}` }),
        gitElement(document, 'p', { className: 'git-muted', text: 'Check out this pull request to mark current comments in the unchanged source file.' }));
      for (const comment of result.comments.slice(page * 50, page * 50 + 50)) {
        const row = gitElement(document, 'article', { className: 'git-provider-item' },
          gitElement(document, 'strong', { text: `${comment.author}${comment.path ? ` · ${comment.path}` : ''}${comment.line ? `:${comment.line}` : ''}` }),
          gitElement(document, 'p', { text: comment.body }));
        if (comment.line && (!comment.headOid || comment.headOid === result.pullRequest.sourceOid)) row.append(
          gitButton(document, 'Show in Source', () => workbench.safe(() =>
            annotateGitReviewFile(workbench, result, comment.path, { signal: controller.signal }))));
        else row.append(gitElement(document, 'small', { text: 'General, old-side, or outdated comment; no current source annotation.' }));
        if (comment.url) row.append(gitElement(document, 'a', { href: comment.url, text: 'Open comment', target: '_blank', rel: 'noopener noreferrer' }));
        reviews.append(row);
      }
      reviews.append(gitElement(document, 'p', { text: `${result.comments.length} review comments` }),
        gitButton(document, 'Previous comments', () => { page--; draw(); }, { disabled: page === 0 }),
        gitButton(document, 'Next comments', () => { page++; draw(); }, { disabled: (page + 1) * 50 >= result.comments.length }));
    };
    draw();
  };
  const load = async (type, selected, options = {}) => {
    kind = type;
    const revision = ++generation;
    const identity = selected ?? target();
    status.textContent = 'Loading…';
    try {
      const items = await invoke(identity, type === 'issue' ? 'listIssues' : 'listPullRequests', { state: 'open' }, undefined, options);
      if (generation !== revision) return;
      let page = 0;
      const draw = () => {
        list.replaceChildren();
        for (const item of items.slice(page * 50, page * 50 + 50)) {
        const id = item.id;
        const row = gitElement(document, 'article', { className: 'git-provider-item', role: 'listitem' },
          gitElement(document, 'h3', { text: `#${id} ${item.title}` }),
          gitElement(document, 'p', { className: 'git-muted', text: item.state }), gitElement(document, 'p', { text: item.body }));
        if (item.url?.startsWith('https://')) row.append(gitElement(document, 'a', {
          href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open in provider'
        }));
        row.append(gitButton(document, 'Comment…', () => compose(identity, 'Add Comment', [
          { name: 'body', label: 'Comment', multiline: true, required: true }
        ], (values, options) => invoke(identity, 'addComment', { ...values, number: id, kind: type }, type, options), type)));
        if (type === 'pullRequest') row.append(gitButton(document, 'Review…', () => review(identity, id)),
          gitButton(document, 'Check Out…', () => checkout(identity, id), { disabled: !workbench.repositoryId || !workbench.workspaceBound }),
          gitButton(document, 'Review Comments', () => workbench.safe(() => showReview(identity, id))));
          list.append(row);
        }
        list.append(gitButton(document, 'Previous items', () => { page--; draw(); }, { disabled: page === 0 }),
          gitButton(document, 'Next items', () => { page++; draw(); }, { disabled: (page + 1) * 50 >= items.length }));
      };
      draw();
      status.textContent = `${items.length} open ${type === 'issue' ? 'issues' : 'pull requests'}`;
    } catch (error) { status.textContent = error.message; throw error; }
  };
  const create = async type => {
    kind = type;
    const identity = target();
    const head = type === 'pullRequest' ? await currentGitPullRequestBranch(workbench, { signal: controller.signal }) : undefined;
    compose(identity, type === 'issue' ? 'Create Issue' : 'Create Pull Request', [
      { name: 'title', label: 'Title', required: true }, { name: 'body', label: 'Description', multiline: true },
      ...(type === 'pullRequest' ? [{ name: 'head', label: 'Current source branch', value: head, required: true },
        { name: 'base', label: 'Target branch', value: workbench.preferences.model.values.defaultBranch || 'main', required: true }] : [])
    ], async (values, options) => {
      if (type === 'pullRequest' && values.head !== await currentGitPullRequestBranch(workbench, options)) {
        throw new Error('The source must be the current local branch. Check out that branch before creating its pull request.');
      }
      return invoke(identity, type === 'issue' ? 'createIssue' : 'createPullRequest', values, type, options);
    }, type, true);
  };
  remote.addEventListener('change', () => workbench.safe(accounts));
  provider.addEventListener('change', () => workbench.safe(accounts));
  credential.addEventListener('change', () => workbench.credentialIds.set(target().remoteId, credential.value));
  element.replaceChildren(gitElement(document, 'div', { className: 'git-provider-form' },
    gitField(document, 'Provider', provider), gitField(document, 'Repository URL', remote), gitField(document, 'Account', credential)),
  gitElement(document, 'div', { className: 'git-toolbar' },
    gitButton(document, 'Pull Requests', () => workbench.safe(() => load('pullRequest'))),
    gitButton(document, 'Issues', () => workbench.safe(() => load('issue'))),
    gitButton(document, 'New Pull Request', () => workbench.safe(() => create('pullRequest'))),
    gitButton(document, 'New Issue', () => workbench.safe(() => create('issue'))),
    gitButton(document, 'Sign In…', () => workbench.safe(async () => {
      const identity = target();
      await workbench.preferences.signIn(identity.remote, identity.provider, { signal: controller.signal });
      await accounts();
    })), gitButton(document, 'Git Settings', () => workbench.host.showPanel('git-settings'))), created, status, list, reviews);
  showCreated();
  await accounts();
  return () => { generation++; controller.abort(); };
}
