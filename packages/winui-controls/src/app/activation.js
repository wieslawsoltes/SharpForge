import { ControlEvents, ControlError } from '../policy/events.js';

export class ActivationService extends ControlEvents {
  constructor({ url = 'https://localhost/', launchQueue = null, policy = null } = {}) {
    super();
    this.policy = policy;
    this.disposed = false;
    const launch = new URL(url);
    if (!['http:', 'https:'].includes(launch.protocol) || launch.username || launch.password) {
      throw new ControlError('SFUI16A4', 'The activation protocol is unsupported');
    }
    this.current = launch.search || launch.hash ? { Kind: 'Protocol', Data: { Uri: launch.href, Arguments: launch.search.slice(1) } }
      : { Kind: 'Launch', Data: { Arguments: '' } };
    this.launchQueue = launchQueue;
    if (launchQueue?.setConsumer) launchQueue.setConsumer(params => this.acceptLaunch(params));
  }
  getActivatedEventArgs() { return this.current; }
  activateProtocol(uri) {
    const url = new URL(uri);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ControlError('SFUI16A4', 'The activation protocol is unsupported');
    }
    this.publish({ Kind: 'Protocol', Data: { Uri: url.href } });
  }
  async acceptLaunch(parameters) {
    if (this.disposed) return;
    try {
      if (parameters.files?.length) {
        if (!await this.policy?.authorize('file-activation', { count: parameters.files.length })) {
          this.emit('ActivationRejected', { Kind: 'File', Reason: 'permission-denied' });
          return;
        }
        if (!this.disposed) this.publish({ Kind: 'File', Data: { Files: [...parameters.files] } });
      } else if (parameters.targetURL) this.activateProtocol(parameters.targetURL);
      else this.publish({ Kind: 'Launch', Data: { Arguments: '' } });
    } catch (error) { this.emit('ActivationRejected', { Kind: 'Unknown', Reason: error.code ?? error.name }); }
  }
  publish(args) { this.current = args; this.emit('Activated', args); }
  unsupported(kind) { throw new ControlError('SFUI16A5', 'The browser cannot provide this activation kind', { kind }); }
  snapshot() { return { version: 1, current: this.current }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI16A5', 'Invalid activation snapshot');
    this.current = snapshot.current;
  }
  *retainedValues() { yield this.current; }
  dispose() { this.disposed = true; super.dispose(); }
}
