import {ProviderDiskWorkspace} from '@sharpforge/project-system';
import {ExplorerDiskServices} from '../../apps/studio/explorer/disk-services.js';
import {DelayedProvider} from './a24-delayed-provider.js';
import {diskTestView} from './a24-disk-dom.js';

export const diskBytes = value => new TextEncoder().encode(value);

export class ControlledDiskProvider extends DelayedProvider {
  constructor() { super(); this.subscriptions = []; }

  async watch(path, listener) {
    const subscription = {disposed: false, paths: [], listener,
      dispose() { this.disposed = true; }, setWatchedPaths(paths) { this.paths = paths; }};
    this.subscriptions.push(subscription);
    await this.waitFor('watch', path);
    return subscription;
  }

  pauseMetadata(path, after = 0) {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    this.metadataPause = {path, after, entered, release};
    return {entered: entered.promise, release: release.resolve, reject: release.reject};
  }

  async stat(path, options) {
    const result = await super.stat(path, options);
    const gate = this.metadataPause;
    if (gate?.path === path && gate.after-- === 0) {
      this.metadataPause = null;
      gate.entered.resolve();
      await gate.release.promise;
    }
    return result;
  }
}

export async function diskServiceFixture({records = null, provider = new ControlledDiskProvider(), watchGate = false,
  previousSearch = undefined} = {}) {
  await provider.writeFile('open.cs', diskBytes('initial needle'));
  await provider.writeFile('closed.cs', diskBytes('closed needle'));
  records ??= [{path: 'open.cs', text: 'initial needle', version: 1}, {path: 'closed.cs', size: 13, lazy: true}];
  const disk = new ProviderDiskWorkspace(records, new Map(), 'Services', [], [], {provider});
  await disk.initializeBaselines();
  if (previousSearch) disk.findInFiles = previousSearch;
  const data = {disk, provider, records, dirty: [], tabs: ['open.cs'], revision: 1, fileBusy: false};
  const commands = [];
  const errors = [];
  const opened = [];
  const view = diskTestView({getData: () => data, onError: error => errors.push(error),
    onOpen: node => opened.push(node), onCommand: (action, node, selected, payload) => {
      commands.push({action, node, selected, payload});
      return {reevaluated: action === 'disk-external-change' && /\.csproj$/.test(payload.path)};
    }});
  const service = new ExplorerDiskServices(view);
  const gate = watchGate ? provider.pause('watch', '') : null;
  service.observe(data);
  await service.indexReady;
  if (!watchGate) await service.opening;
  return {provider, disk, data, service, view, commands, errors, opened, gate,
    dispose() { service.dispose(); provider.dispose(); }};
}
