import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGitRepository } from '../apps/studio/git-history-view.js';
import { virtualRange } from '../apps/studio/git-virtual.js';
import { fixtureDescendants } from './a25-auth-ui-fixture.js';
import { virtualDocument } from './git-tools/virtual-dom.js';

function historyCommits(count) {
  const oid = index => index.toString(16).padStart(40, '0');
  return Array.from({ length: count }, (_, index) => ({
    oid: oid(count - index), parents: index + 1 < count ? [oid(count - index - 1)] : [],
    message: `Commit ${count - index}`, author: 'Fixture author <fixture@example.test>'
  }));
}

test('production history stays within its DOM row budget at fractional scroll positions and the oldest commit', async t => {
  const fixture = virtualDocument();
  const root = fixture.document.createElement('section');
  const commits = historyCommits(10000);
  const workbench = { repositoryId: 'history', historyOnly: true,
    async request(method) { assert.equal(method, 'log'); return commits; },
    safe(action) { return action(); }
  };
  const dispose = await renderGitRepository(root, workbench);
  t.after(dispose);
  const viewport = fixtureDescendants(root).find(element => element.className === 'git-history-viewport');
  const maximumScroll = 10000 * 30 - viewport.clientHeight;
  for (const scrollTop of [0, 0.5, 29.5, 3000.25, 150000.75, maximumScroll - 0.5, maximumScroll]) {
    viewport.scrollTop = scrollTop;
    await viewport.dispatch('scroll');
    await fixture.flush();
    const rows = fixtureDescendants(viewport).filter(element => element.className?.split(' ').includes('git-history-row'));
    assert.ok(rows.length > 0);
    assert.ok(rows.length <= Math.ceil(viewport.clientHeight / 30) + 10, `${rows.length} mounted rows at ${scrollTop}`);
    const positions = rows.map(row => Number(row.getAttribute('aria-posinset')) - 1);
    assert.equal(new Set(positions).size, rows.length);
    assert.ok(positions[0] <= Math.floor(scrollTop / 30));
    assert.ok(positions.at(-1) >= Math.min(10000, Math.ceil((scrollTop + viewport.clientHeight) / 30)) - 1);
    assert.ok(rows.every(row => !row.textContent.includes('Loading')));
  }
  assert.ok(fixtureDescendants(viewport).some(element => element.className === 'git-history-message' && element.textContent === 'Commit 1'));
  await viewport.dispatch('scroll');
  dispose();
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.observers.size, 0);
});

test('explicit virtual overscan rejects invalid or unbounded row counts', () => {
  for (const overscan of [-1, 0.5, NaN, Infinity, 101]) {
    assert.throws(() => virtualRange({ count: 10000, rowHeight: 30, overscan }), RangeError);
  }
  const range = virtualRange({ count: 10000, rowHeight: 30, viewportHeight: 329, scrollTop: 3000.25, overscan: 0 });
  assert.equal(range.start, 100);
  assert.equal(range.end, 111);
});
