import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtifactFilters } from '../apps/studio/services/artifacts.js';
import { downloadStudioArtifact } from '../apps/studio/services/downloads.js';
import { exportGitArchive } from '../apps/studio/git-archive-dialogs.js';

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function downloadHost(artifacts) {
  const captured = { urls: [], clicked: [], revoked: [], errors: [], timers: [] };
  return { captured, artifacts,
    urls: { createObjectURL: blob => { captured.urls.push(blob); return 'blob:cancel-fixture'; },
      revokeObjectURL: url => captured.revoked.push(url) },
    document: { createElement: () => ({ click() { captured.clicked.push(this.download); } }) },
    schedule: action => captured.timers.push(action), onError: error => captured.errors.push(error) };
}

function assertNotDelivered(host) {
  assert.equal(host.captured.urls.length, 0);
  assert.equal(host.captured.clicked.length, 0);
  assert.equal(host.captured.timers.length, 0);
  assert.equal(host.captured.errors.length, 1);
  assert.equal(host.captured.errors[0].name, 'AbortError');
}

test('an already cancelled download never enters artifact preparation or allocates a browser URL', async () => {
  let prepared = false;
  const host = downloadHost({ prepare() { prepared = true; throw new Error('Preparation must not start'); } });
  const controller = new AbortController();
  controller.abort();
  assert.equal(await downloadStudioArtifact(host, 'cancelled.zip', new Uint8Array([1]), 'application/zip',
    { signal: controller.signal }), null);
  assert.equal(prepared, false);
  assertNotDelivered(host);
});

for (const format of ['zip', 'bundle']) {
  test(`cancelling ${format} export during the actual artifact filter prevents late download delivery`,
    { timeout: 5000 }, async context => {
      const filters = createArtifactFilters();
      const entered = deferred();
      const release = deferred();
      let filterSignal;
      filters.register('delayed-sanitizer', async (artifact, { signal }) => {
        filterSignal = signal;
        entered.resolve();
        await release.promise;
        return artifact;
      });
      context.after(() => { release.resolve(); filters.dispose(); });
      const host = downloadHost(filters);
      const cancellation = new AbortController();
      const operation = new AbortController();
      const workbench = {
        repositoryId: 'download-fixture',
        host: { download: (...args) => downloadStudioArtifact(host, ...args) },
        run: action => action({ signal: operation.signal }),
        synchronize: async () => {},
        request: async (method, params, options) => {
          assert.equal(method, format === 'zip' ? 'exportZip' : 'exportBundle');
          assert.equal(options.signal.aborted, false);
          return { bytes: new Uint8Array([1, 2, 3]), entries: [], refs: [], objects: 0 };
        }
      };
      const pending = exportGitArchive(workbench, { format, filename: `repository.${format}`, signal: cancellation.signal });
      const rejected = assert.rejects(pending, { code: 'Cancelled' });
      await entered.promise;
      assert.ok(filterSignal instanceof AbortSignal);
      assert.equal(filterSignal.aborted, false);
      cancellation.abort();
      assert.equal(filterSignal.aborted, true);
      assert.equal(operation.signal.aborted, false, 'Dialog cancellation stays scoped to this export');
      release.resolve();
      await rejected;
      assertNotDelivered(host);
      assert.equal(workbench.repositoryToolsResult.ok, false);
      assert.equal(workbench.repositoryToolsResult.details.code, 'Cancelled');
    });
}
