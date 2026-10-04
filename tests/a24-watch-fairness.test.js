import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystemProvider, PollingFileWatcher} from '@sharpforge/workspace';

const bytes = value => new TextEncoder().encode(value);

for (const budget of [1, 3]) {
  test(`A24 saturated watcher budget ${budget} visits every priority and background file`, async () => {
    const provider = new MemoryFileSystemProvider();
    const paths = Array.from({length: 10}, (_, index) => `File${index}.cs`);
    for (const path of paths) await provider.writeFile(path, bytes('before'));
    const events = [];
    const watcher = new PollingFileWatcher(provider, event => events.push(event), {
      maxStatsPerTick: budget, maxDirectoryEntriesPerTick: 1, watchedPaths: paths.slice(0, 8)
    });
    await watcher.start({schedule: false});
    for (const path of paths) await provider.writeFile(path, bytes('after'));
    for (let iteration = 0; iteration < 20; iteration++) {
      const before = watcher.metrics.statCalls;
      await watcher.poll();
      assert(watcher.metrics.statCalls - before <= budget);
    }
    assert.deepEqual(new Set(events.filter(event => event.type === 'changed').map(event => event.path)), new Set(paths));
    watcher.setWatchedPaths([paths[9]]);
    await provider.writeFile(paths[9], bytes('latest'));
    await watcher.poll();
    await watcher.poll();
    assert(events.some(event => event.path === paths[9] && event.hash === provider.find(paths[9]).hash));
    watcher.dispose();
    provider.dispose();
  });
}
