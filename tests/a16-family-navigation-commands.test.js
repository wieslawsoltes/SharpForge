import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationFrame } from '../packages/winui-controls/src/navigation/frame.js';

test('frame history recreates uncached pages and retains required cached pages', () => {
  const created = [];
  const frame = new NavigationFrame({ cacheSize: 0, factory: type => {
    const page = { type, NavigationCacheMode: type === 'cached' ? 1 : 0 };
    created.push(page);
    return page;
  } });
  frame.navigate('uncached', 10);
  const first = frame.content;
  frame.navigate('cached', 20);
  const cached = frame.content;
  assert.equal(frame.canGoBack, true);
  frame.goBack();
  assert.notEqual(frame.content, first);
  assert.equal(frame.current.parameter, 10);
  frame.goForward();
  assert.equal(frame.content, cached);
  assert.equal(created.length, 3);
  frame.navigate('new');
  assert.equal(frame.canGoForward, false);
});

test('cancelled and failed navigation keep committed frame history unchanged', () => {
  const frame = new NavigationFrame({ factory: type => ({ type, OnNavigatedTo() {
    if (type === 'fail') throw new Error('page failed');
  } }) });
  frame.navigate('first');
  const first = frame.content;
  const cancel = frame.on('Navigating', args => { if (args.SourcePageType === 'cancel') args.Cancel = true; });
  assert.equal(frame.navigate('cancel'), false);
  assert.equal(frame.content, first);
  assert.equal(frame.backStackDepth, 0);
  cancel();
  assert.throws(() => frame.navigate('fail'), /page failed/);
  assert.equal(frame.content, first);
  assert.equal(frame.backStackDepth, 0);
  const snapshot = frame.snapshot();
  frame.navigate('later');
  frame.restore(snapshot);
  assert.equal(frame.content, first);
});
