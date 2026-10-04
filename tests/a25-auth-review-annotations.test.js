import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText } from '../packages/text/src/index.js';
import { GitService } from '../packages/git/src/service.js';
import { repository, commitFile } from './a25-workflow-fixtures.js';
import { createEditorAnnotations } from '../apps/studio/services/annotations.js';
import { gitReviewComments, annotateGitReviewFile, readGitReview } from '../apps/studio/git-provider-annotations.js';
import { fixtureDocument } from './a25-auth-ui-fixture.js';

const oid = 'a'.repeat(40);
// Primary schema fixtures; Gitea's structs/pull_review.go and convert/pull_review.go define position as a new-file line.
const contracts = [
  ['github', [{ id: 'thread', path: 'Program.cs', line: 2, diffSide: 'RIGHT', isOutdated: false,
    comments: { nodes: [{ id: 1, body: 'Review', author: { login: 'Reviewer' } }] } }]],
  ['gitlab', [{ id: 'thread', notes: [{ id: 1, body: 'Review', author: { username: 'Reviewer' },
    position: { new_path: 'Program.cs', new_line: 2, head_sha: oid } }] }]],
  ['bitbucket', [{ id: 1, content: { raw: 'Review' }, user: { display_name: 'Reviewer' }, inline: { path: 'Program.cs', to: 2, outdated: false } }]],
  ['azure', [{ id: 1, reviewedIteration: 2, reviewedHeadOid: oid, threadContext: { filePath: '/Program.cs', rightFileStart: { line: 2 } },
    pullRequestThreadContext: { trackingCriteria: { secondComparingIteration: 2 } }, comments: [{ id: 1, content: 'Review', author: { displayName: 'Reviewer' } }] }]],
  ['gitea', [{ id: 1, stale: false, comments: [{ id: 1, body: 'Review', user: { login: 'Reviewer' },
    path: 'Program.cs', position: 2, original_position: 0, commit_id: oid }] }]]
];

for (const [provider, threads] of contracts) test(`A25 ${provider} review positions map to bounded current-file annotation records`, () => {
  const comments = gitReviewComments(provider, threads);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].path, 'Program.cs');
  assert.equal(comments[0].line, 2);
  assert.equal(comments[0].body, 'Review');
  assert.throws(() => gitReviewComments(provider, threads, { maximumComments: 0 }), { code: 'Limit' });
});

test('A25 old-side, outdated, untracked, unsafe-path and deleted review comments do not acquire source lines', () => {
  assert.equal(gitReviewComments('github', [{ ...contracts[0][1][0], diffSide: 'LEFT' }])[0].line, null);
  assert.equal(gitReviewComments('github', [{ ...contracts[0][1][0], isOutdated: true }])[0].line, null);
  assert.equal(gitReviewComments('github', [{ ...contracts[0][1][0], path: '../escape' }])[0].line, null);
  assert.equal(gitReviewComments('bitbucket', [{ ...contracts[2][1][0], inline: { path: 'Program.cs', from: 2 } }])[0].line, null);
  assert.equal(gitReviewComments('azure', [{ ...contracts[3][1][0], reviewedIteration: 3 }])[0].line, null);
  assert.equal(gitReviewComments('gitea', [{ ...contracts[4][1][0], stale: true }])[0].line, null);
  assert.deepEqual(gitReviewComments('bitbucket', [{ ...contracts[2][1][0], deleted: true }]), []);
});

async function annotationFixture(t) {
  const repo = await repository();
  const text = 'α\r\nclass Reviewed {}\r\n';
  const commit = await commitFile(repo, 'Program.cs', text);
  const service = new GitService({ repositoryFactory: async () => repo,
    operations: [{ name: 'head', run: repo => repo.refs.resolve('HEAD') }] });
  service.attach('local', repo);
  t.after(() => service.dispose());
  const document = fixtureDocument();
  const annotations = createEditorAnnotations();
  t.after(() => annotations.dispose());
  const documents = new Set();
  let workspace = 'workspace';
  const editor = { uri: 'Program.cs', value: text, element: document.createElement('section'), input: document.createElement('textarea'),
    sourceSnapshot() { return new SourceText(this.value, this.uri); },
    setDiagnostics() { throw new Error('Review must use the owned service, not replace language diagnostics'); }, gotoLine() {} };
  const workbench = { repositoryId: 'local', workspaceBound: true,
    request: (method, params = {}, options) => service.request(method, { repositoryId: 'local', ...params }, options),
    host: { getWorkspaceIdentity: () => workspace, getState: () => ({ active: 'Program.cs' }),
      openFile() {}, getEditors: () => new Map([['Program.cs', editor]]), services: { get(name) {
        if (name === 'annotations') return annotations;
        assert.equal(name, 'documents');
        return { subscribe(listener) { documents.add(listener); return () => documents.delete(listener); } };
      } } }
  };
  const review = { pullRequest: { id: 7, sourceOid: commit.oid }, comments: gitReviewComments(...contracts[0]) };
  return { workbench, editor, annotations, review, text, emit: event => [...documents].forEach(listener => listener(event)),
    switchWorkspace: () => { workspace = 'another'; } };
}

test('A25 actual source read creates owned editor review diagnostics and editing clears only its contribution', async t => {
  const { workbench, editor, annotations, review, emit } = await annotationFixture(t);
  annotations.set('compiler', 'Program.cs', [{ message: 'Compiler diagnostic', start: 0, length: 1 }]);
  const handle = await annotateGitReviewFile(workbench, review, 'Program.cs');
  const item = annotations.get('Program.cs').find(value => value.source === 'git-review');
  assert.equal(item.start, 3);
  assert.equal(item.range.start.line, 1);
  assert.equal(item.message, 'Reviewer: Review');
  assert.equal(workbench.reviewAnnotations, handle);
  emit({ uri: 'Other.cs' });
  assert.equal(annotations.get('Program.cs').length, 2);
  editor.value = 'Changed';
  emit({ uri: 'Program.cs' });
  assert.deepEqual(annotations.get('Program.cs').map(item => item.source), ['compiler']);
  assert.equal(workbench.reviewAnnotations, null);
  assert.equal(editor.element.children.length, 0);
});

test('A25 review annotation binding rejects a different HEAD, dirty text, mid-read edits and cancellation', async t => {
  const { workbench, editor, annotations, review, text } = await annotationFixture(t);
  await assert.rejects(annotateGitReviewFile(workbench, { ...review, pullRequest: { id: 7, sourceOid: oid } }, 'Program.cs'), { code: 'Conflict' });
  editor.value = 'Dirty';
  await assert.rejects(annotateGitReviewFile(workbench, review, 'Program.cs'), { code: 'Conflict' });
  editor.value = text;
  const request = workbench.request;
  let heads = 0;
  workbench.request = async (...args) => {
    const result = await request(...args);
    if (args[0] === 'head' && ++heads === 2) editor.value = 'Edited while reading HEAD';
    return result;
  };
  await assert.rejects(annotateGitReviewFile(workbench, review, 'Program.cs'), { code: 'Conflict' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(annotateGitReviewFile(workbench, review, 'Program.cs', { signal: controller.signal }), { code: 'Cancelled' });
  assert.deepEqual(annotations.get('Program.cs'), []);
});

test('A25 review snapshots reject a source commit change observed between their two detail reads', async () => {
  let reads = 0;
  const workbench = { credentialIds: new Map(), preferences: { grant: async () => {}, auth: async () => [] },
    request: async (_, params) => params.operation === 'getPullRequest' ? { id: 7, sourceOid: ++reads === 1 ? oid : 'b'.repeat(40) } : [] };
  await assert.rejects(readGitReview(workbench, { remote: 'https://github.com/acme/project', provider: 'github' }, 7), { code: 'Conflict' });
});

test('A25 a workspace replacement invalidates review diagnostics without clearing another source', async t => {
  const { workbench, annotations, review, switchWorkspace, emit } = await annotationFixture(t);
  annotations.set('compiler', 'Program.cs', [{ message: 'Compiler diagnostic' }]);
  await annotateGitReviewFile(workbench, review, 'Program.cs');
  switchWorkspace();
  emit({ uri: 'Other.cs' });
  assert.deepEqual(annotations.get('Program.cs').map(item => item.source), ['compiler']);
  assert.equal(workbench.reviewAnnotations, null);
});
