import { GitError } from './errors.js';

/** Repository data never becomes executable configuration. Extensions are explicit capabilities. */
export class GitExecutionPolicy {
  constructor({ notice = () => {}, filters = new Map(), signers = new Map() } = {}) {
    this.notice = notice;
    this.filters = new Map(filters);
    this.signers = new Map(signers);
    this.reported = new Set();
  }

  ignored(setting) {
    if (this.reported.has(setting)) return;
    this.reported.add(setting);
    this.notice({ code: 'GitPolicyIgnored', setting, message: 'Repository executable setting is ignored' });
  }

  inspect(config) {
    for (const key of ['core.hooksPath', 'core.fsmonitor', 'core.sshCommand', 'core.editor', 'sequence.editor']) {
      if (config?.get(key) !== undefined && config?.get(key) !== null) this.ignored(key);
    }
    for (const entry of config?.entries?.() ?? []) {
      const key = Array.isArray(entry) ? entry[0] : entry.key;
      if (key && /^(?:alias\.|filter\.|mergetool\.|difftool\.|credential\.helper$)/iu.test(key)) this.ignored(key);
    }
  }

  filter(name) {
    const filter = this.filters.get(name);
    if (filter) return filter;
    this.ignored(`filter.${name}`);
    return null;
  }

  signer(format) {
    const signer = this.signers.get(format);
    if (!signer) throw new GitError('Unsupported', 'Signing requires an explicitly registered key provider', { format });
    return signer;
  }
}
