import {createOpfsSyncWorkerHandler} from './opfs-worker-service.js';

const controllers = new Map();
const invoke = createOpfsSyncWorkerHandler();
let mutations = Promise.resolve();

self.addEventListener('message', event => {
  const {id, method, payload} = event.data ?? {};
  if (!Number.isSafeInteger(id)) return;
  if (method === 'cancel') { controllers.get(id)?.abort(); return; }
  const controller = new AbortController();
  controllers.set(id, controller);
  const run = async () => {
    try {
      const result = await invoke(method, payload, {signal: controller.signal});
      self.postMessage({id, result}, result.bytes ? [result.bytes.buffer] : []);
    } catch (error) {
      self.postMessage({id, error: {code: error.code ?? 'Io', message: error.message, path: error.path}});
    } finally { controllers.delete(id); }
  };
  if (method === 'writeFile') { mutations = mutations.then(run); }
  else void run();
});
