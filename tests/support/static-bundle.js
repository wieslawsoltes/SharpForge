import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Script } from 'node:vm';

export async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return root;
}

export function execute(source, globals = {}) {
  const scope = { ...globals };
  scope.self = scope;
  new Script(source).runInNewContext(scope);
  return scope;
}

/** Captures bytes/URL lifetimes; worker programs are executed in separate VM contexts in controller tests. */
export function workerGlobals() {
  const blobs = new Map(), revoked = [], workers = [], events = new Map();
  class FixtureURL extends URL {
    static createObjectURL(blob) {
      const key = `blob:https://fixture.test/${blobs.size}`;
      blobs.set(key, blob);
      return key;
    }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  class FixtureWorker {
    constructor(url, options) { workers.push({ url: String(url), options }); }
  }
  return { blobs, revoked, workers, events, globals: { Blob, URL: FixtureURL, Worker: FixtureWorker,
    addEventListener: (name, listener) => events.set(name, listener) } };
}

export const html = '<!doctype html><html><head><title>Fixture</title><link rel="stylesheet" href="./studio.css">' +
  '</head><body><script type="module" src="./studio.js"></script></body></html>';
