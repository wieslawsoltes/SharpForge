import { createGitService, createGitWorkerServer } from '@sharpforge/git';

const storageWorker = new URL('../../packages/git/src/storage/opfs-worker.js', import.meta.url);
createGitWorkerServer({ endpoint: globalThis, createService: () => createGitService({
    repositoryOptions: { workerUrl: storageWorker }
}) });
