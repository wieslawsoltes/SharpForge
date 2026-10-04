/** Workspace-scoped revision/presence channel. Receivers mark stale state; receiving a message never writes an editor buffer. */
export class WorkspaceRevisionChannel {
  constructor({identity, channelFactory = name => new BroadcastChannel(name), windowId = crypto.randomUUID(),
    onRevision = () => {}, onPresence = () => {}, onError = () => {}}) {
    if (typeof identity !== 'string' || !identity || identity.length > 4096) throw new Error('SFW1401: Invalid workspace identity');
    Object.assign(this, {identity, windowId, onRevision, onPresence, onError});
    this.sequence = 0;
    this.seen = new Map();
    this.documents = new Map();
    this.presence = new Set();
    this.disposed = false;
    this.channel = channelFactory('sharpforge-workspace:' + identity);
    this.receiveEvent = event => {
      try { this.receive(event.data); }
      catch (error) { this.onError(error); }
    };
    this.channel.addEventListener('message', this.receiveEvent);
    this.publish('presence', {state: 'join'});
  }

  publish(kind, value) {
    if (this.disposed) throw new Error('SFW1402: Workspace channel is disposed');
    this.channel.postMessage({version: 1, identity: this.identity, sender: this.windowId,
      sequence: ++this.sequence, kind, ...value});
  }

  publishRevision({path, revision, hash, baseHash = null, resolution = null}) {
    if (typeof path !== 'string' || !path || path.length > 8192 || !Number.isSafeInteger(revision) || revision < 0 ||
        typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('SFW1403: Invalid document revision');
    this.documents.set(path, {revision, hash, baseHash, stale: false});
    this.publish('revision', {path, revision, hash, baseHash, resolution});
  }

  receive(message) {
    if (this.disposed || message?.identity !== this.identity || message.sender === this.windowId) return;
    if (message.version !== 1 || typeof message.sender !== 'string' || message.sender.length > 128 ||
        !Number.isSafeInteger(message.sequence) || message.sequence < 1) throw new Error('SFW1403: Invalid channel envelope');
    if ((this.seen.get(message.sender) ?? 0) >= message.sequence) return;
    if (this.seen.size > 256 && !this.seen.has(message.sender)) throw new Error('SFW1404: Workspace window limit exceeded');
    this.seen.set(message.sender, message.sequence);
    if (message.kind === 'presence') {
      if (message.state === 'leave') this.presence.delete(message.sender);
      else if (message.state === 'join' || message.state === 'present') {
        this.presence.add(message.sender);
        if (message.state === 'join') this.publish('presence', {state: 'present'});
      } else throw new Error('SFW1403: Invalid presence message');
      this.onPresence([...this.presence]);
      return;
    }
    if (message.kind !== 'revision' || typeof message.path !== 'string' || message.path.length > 8192 ||
        !Number.isSafeInteger(message.revision) || message.revision < 0 || !/^[0-9a-f]{64}$/.test(message.hash ?? '')) {
      throw new Error('SFW1403: Invalid revision message');
    }
    const local = this.documents.get(message.path);
    const stale = !!local && local.hash !== message.hash;
    if (local) local.stale = stale;
    this.onRevision({...message, stale, divergent: stale && local.baseHash !== message.hash, local: local ? {...local} : null});
  }

  dispose() {
    if (this.disposed) return;
    this.publish('presence', {state: 'leave'});
    this.disposed = true;
    this.channel.removeEventListener('message', this.receiveEvent);
    this.channel.close();
    this.documents.clear();
    this.presence.clear();
  }
}
