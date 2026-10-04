import { GitPreferences } from '../../apps/studio/git-preferences.js';
import { openService } from '../git-adjuncts/fixture.js';

/** Only the Studio host is a harness; all repository requests execute the real Git service. */
export async function toolsWorkbench(context, options = {}) {
  const { service, repo } = await openService(context, {}, options);
  const events = [];
  const state = { dirtyFiles: new Set(), membershipDirty: false };
  const workbench = {
    repositoryId: 'default', credentialIds: new Map(), service, repo, events, state,
    host: { getState: () => state, toast: message => events.push({ type: 'toast', message }),
      download: async (name, bytes, mimeType) => {
        events.push({ type: 'download', name, bytes, mimeType });
        return { name, bytes, mimeType };
      } },
    request(method, params = {}, settings) {
      events.push({ type: 'request', method, params });
      return service.request(method, { repositoryId: this.repositoryId, ...params }, settings);
    },
    async run(action) {
      this.controller = new AbortController();
      try { return await action({ signal: this.controller.signal }); }
      finally { this.controller = null; }
    },
    safe(action) { this.lastAction = Promise.resolve().then(action); return this.lastAction; },
    async synchronize() { events.push({ type: 'synchronize' }); },
    async adoptRepository(settings) {
      events.push({ type: 'adopt' });
      this.adopted = await service.request('files', {}, settings);
    },
    async refresh() { events.push({ type: 'refresh' }); }
  };
  workbench.preferences = new GitPreferences(workbench, null);
  return workbench;
}

export async function grantToolOrigin(workbench, origin) {
  await workbench.preferences.auth('grant', { remoteId: origin, origins: [origin], consent: true });
  workbench.preferences.model.grants.grant(origin, [origin]);
}

export function archiveFile(bytes) {
  return { name: 'fixture.archive', size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
