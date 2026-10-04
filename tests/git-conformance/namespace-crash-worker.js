import { parentPort, workerData } from 'node:worker_threads';
import { NodeFileStore } from '../../packages/git/src/fs/node-store.js';
import { NodeDirectoryIO } from '../../packages/git/src/fs/node-io.js';
import { RefDatabase } from '../../packages/git/src/refs.js';

parentPort.on('message', () => {});

class InterruptedDirectoryIO extends NodeDirectoryIO {
  async checkpoint(operation, key) {
    if (`${operation}:${key}` !== workerData.checkpoint) return;
    parentPort.postMessage({ type: 'checkpoint', operation, key });
    await new Promise(() => {});
  }

  async get(key, options) {
    const value = await super.get(key, options);
    if (`prepare:${key}` === workerData.checkpoint) {
      const bytes = await super.get('.sharpforge-node-transaction/manifest');
      if (bytes && JSON.parse(new TextDecoder().decode(bytes)).state === 'prepare') await this.checkpoint('prepare', key);
    }
    return value;
  }

  async delete(key) {
    await super.delete(key);
    await this.checkpoint('delete', key);
  }

  async publish(key) {
    await super.publish(key);
    await this.checkpoint('publish', key);
  }
}

const store = new NodeFileStore({ directory: workerData.directory });
store.io = new InterruptedDirectoryIO({ directory: workerData.directory });
const refs = new RefDatabase({ store });
try {
  await refs.rename(`refs/heads/${workerData.source}`, `refs/heads/${workerData.target}`, {
    expected: workerData.oid, identity: workerData.identity, message: 'interrupted rename'
  });
  parentPort.postMessage({ type: 'unexpected-completion' });
} catch (error) {
  parentPort.postMessage({ type: 'error', code: error.code, message: error.message });
}
