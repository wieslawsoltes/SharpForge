import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVirtualRows } from '../apps/studio/git-virtual.js';
import { virtualDocument } from './git-tools/virtual-dom.js';

function pageFixture(t, options) {
  const fixture = virtualDocument();
  const viewport = fixture.document.createElement('div');
  viewport.setAttribute('role', 'listbox');
  viewport.clientHeight = 30;
  const rendered = [];
  const virtual = mountVirtualRows(viewport, {
    count: 3000, rowHeight: 30, overscan: 0,
    renderRow(value) {
      rendered.push(value);
      const row = fixture.document.createElement('button');
      row.textContent = value;
      return row;
    },
    ...options
  });
  t.after(() => virtual.dispose());
  return { ...fixture, viewport, rendered, virtual };
}

const rows = (start, count) => ({ rows: Array.from({ length: count }, (_, index) => `Row ${start + index}`) });

test('resident virtual pages cover a jumped viewport in the scroll handler without awaiting a frame', async t => {
  const requested = [];
  const fixture = pageFixture(t, { loadPage(start, count) {
    requested.push(start);
    return rows(start, count);
  } });
  assert.equal(fixture.viewport.textContent, 'Row 0');
  assert.deepEqual(fixture.rendered, ['Row 0']);
  assert.equal(fixture.frames.size, 0);
  fixture.viewport.scrollTop = 512 * 30;
  await fixture.viewport.dispatch('scroll');
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.viewport.textContent, 'Row 512');
  const row = fixture.viewport.children[0].children[0];
  assert.equal(row.style.top, `${fixture.viewport.scrollTop}px`, 'The rendered row must occupy the current viewport');
  assert.deepEqual(fixture.rendered, ['Row 0', 'Row 512']);
  assert.deepEqual(requested, [0, 512]);
  assert.equal(fixture.frames.size, 0, 'Resident data must not queue a second rendering pass');
  await fixture.flush();
  assert.deepEqual(fixture.rendered, ['Row 0', 'Row 512']);
});

test('scroll cancels a pending resize frame and disposal removes both immediate and scheduled work', async t => {
  const fixture = pageFixture(t, {loadPage: rows});
  const observer = [...fixture.observers][0];
  observer.callback();
  assert.equal(fixture.frames.size, 1, 'Resize stays scheduled');
  assert.deepEqual(fixture.rendered, ['Row 0']);
  fixture.viewport.scrollTop = 512 * 30;
  await fixture.viewport.dispatch('scroll');
  assert.equal(fixture.frames.size, 0, 'The superseded resize callback must be cancelled');
  assert.equal(fixture.viewport.textContent, 'Row 512');
  fixture.frame();
  assert.deepEqual(fixture.rendered, ['Row 0', 'Row 512'], 'A cancelled callback must not draw twice');
  observer.callback();
  assert.equal(fixture.frames.size, 1);
  fixture.virtual.dispose();
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.observers.size, 0);
  fixture.viewport.scrollTop = 1024 * 30;
  await fixture.viewport.dispatch('scroll');
  fixture.virtual.refresh();
  fixture.frame();
  assert.deepEqual(fixture.rendered, ['Row 0', 'Row 512']);
});

test('asynchronous pages retain pending deduplication and never paint an old viewport position', async t => {
  const pending = new Map();
  const requests = [];
  const fixture = pageFixture(t, { loadPage(start) {
    requests.push(start);
    return new Promise(resolve => pending.set(start, resolve));
  } });
  assert.match(fixture.viewport.textContent, /Loading/u);
  fixture.virtual.refresh();
  fixture.viewport.scrollTop = 256 * 30;
  fixture.virtual.refresh();
  assert.deepEqual(requests, [0, 256]);
  pending.get(0)(rows(0, 256));
  await fixture.flush();
  assert.deepEqual(fixture.rendered, []);
  assert.match(fixture.viewport.textContent, /Loading/u);
  pending.get(256)(rows(256, 256));
  await Promise.resolve();
  assert.equal(fixture.frames.size, 1, 'Asynchronous page completion stays scheduled');
  assert.match(fixture.viewport.textContent, /Loading/u);
  fixture.frame();
  assert.equal(fixture.viewport.textContent, 'Row 256');
  assert.deepEqual(fixture.rendered, ['Row 256']);
  assert.deepEqual(requests, [0, 256]);
  await fixture.flush();
});

test('thenable pages settle through the asynchronous page contract', async t => {
  let subscriptions = 0;
  const fixture = pageFixture(t, { loadPage: () => ({ then(resolve) {
    subscriptions++;
    resolve(rows(0, 256));
  } }) });
  assert.match(fixture.viewport.textContent, /Loading/u);
  await fixture.flush();
  assert.equal(subscriptions, 1);
  assert.equal(fixture.viewport.textContent, 'Row 0');
});

test('sync throws and async rejections retain exact failure values and suppress automatic retries', async t => {
  for (const failure of [new Error('Page unavailable'), undefined, false]) {
    for (const asynchronous of [false, true]) {
      const failures = [];
      let calls = 0;
      const fixture = pageFixture(t, {
        loadPage() {
          calls++;
          if (asynchronous) return Promise.reject(failure);
          throw failure;
        },
        onError: error => failures.push(error)
      });
      await fixture.flush();
      assert.equal(failures.length, 1);
      assert.strictEqual(failures[0], failure);
      assert.match(fixture.viewport.textContent, /Unable to load rows/u);
      fixture.virtual.refresh();
      await fixture.flush();
      assert.equal(calls, 1);
      assert.equal(failures.length, 1);
    }
  }
});

test('virtual page cache retains eight least-recently-used pages for synchronous sources', t => {
  const requests = [];
  const fixture = pageFixture(t, { pageSize: 1,
    loadPage(start) {
      requests.push(start);
      return rows(start, 1);
    }
  });
  const show = index => {
    fixture.viewport.scrollTop = index * 30;
    fixture.virtual.refresh();
  };
  for (let index = 1; index < 8; index++) show(index);
  show(0);
  show(8);
  show(0);
  assert.deepEqual(requests, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  show(1);
  assert.deepEqual(requests, [0, 1, 2, 3, 4, 5, 6, 7, 8, 1]);
  assert.equal(fixture.viewport.textContent, 'Row 1');
  assert.equal(fixture.frames.size, 0);
});

test('disposal ignores late async page results and rejection callbacks', async t => {
  for (const rejected of [false, true]) {
    let finish;
    const failures = [];
    const fixture = pageFixture(t, {
      loadPage: () => new Promise((resolve, reject) => { finish = rejected ? reject : resolve; }),
      onError: error => failures.push(error)
    });
    fixture.virtual.dispose();
    finish(rejected ? new Error('Late page failure') : rows(0, 256));
    await fixture.flush();
    assert.deepEqual(fixture.rendered, []);
    assert.deepEqual(failures, []);
    assert.equal(fixture.frames.size, 0);
    assert.equal(fixture.observers.size, 0);
  }
});

test('aborted or synchronously cancelled virtual loads do not render or retain observers', t => {
  for (const alreadyAborted of [false, true]) {
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    let calls = 0;
    const fixture = pageFixture(t, { signal: controller.signal,
      loadPage() {
        calls++;
        controller.abort();
        return rows(0, 256);
      }
    });
    assert.equal(calls, alreadyAborted ? 0 : 1);
    assert.deepEqual(fixture.rendered, []);
    assert.equal(fixture.frames.size, 0);
    assert.equal(fixture.observers.size, 0);
  }
});
