import { NetworkPolicy } from '@sharpforge/network';
import { WorkbenchEvents } from './state-events.js';

export function defaultSessionSettings() {
  return {
    enabled: false,
    allowedOrigins: [],
    timeoutMs: 10_000,
    maxRequestBytes: 1_048_576,
    maxResponseBytes: 1_048_576,
    maxConcurrent: 4,
    maxQueue: 32,
    compute: { backend: 'auto', workers: 2, maxElements: 1_000_000 }
  };
}

/** Validate grants using the runtime's exact-origin policy, rather than a parallel validator. */
export function validateSessionSettings(settings = {}) {
  const defaults = defaultSessionSettings();
  const next = { ...defaults, ...settings, compute: { ...defaults.compute, ...settings.compute } };
  if (typeof next.enabled !== 'boolean') throw new TypeError('Networking must be explicitly enabled');
  const policy = new NetworkPolicy(next);
  const compute = next.compute;
  if (!['auto', 'wasm', 'scalar'].includes(compute.backend)) throw new TypeError('Unsupported compute backend');
  if (!Number.isSafeInteger(compute.workers) || compute.workers < 1 || compute.workers > 8) throw new RangeError('Invalid compute worker count');
  if (compute.maxElements !== 1_000_000) throw new RangeError('The current compute provider supports a 1,000,000 element limit');
  return { ...next, allowedOrigins: [...policy.origins] };
}

export function sessionLaunchSettings(settings) {
  const value = validateSessionSettings(settings);
  return {
    network: {
      allowedOrigins: value.enabled ? [...value.allowedOrigins] : [],
      timeoutMs: value.timeoutMs,
      maxRequestBytes: value.maxRequestBytes,
      maxResponseBytes: value.maxResponseBytes,
      maxConcurrent: value.maxConcurrent,
      maxQueue: value.maxQueue
    },
    compute: { ...value.compute }
  };
}

/** Grants are held in session memory and intentionally excluded from exportable settings. */
export class SessionSettings {
  constructor(sessions) {
    this.sessions = sessions;
    this.events = new WorkbenchEvents();
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  get(id) {
    const session = this.sessions.require(id);
    return structuredClone(session.runtimeSettings);
  }

  configure(id, patch) {
    const session = this.sessions.require(id);
    const next = validateSessionSettings({
      ...session.runtimeSettings,
      ...patch,
      compute: { ...session.runtimeSettings.compute, ...patch.compute }
    });
    session.runtimeSettings = next;
    this.events.emit({ type: 'settings', sessionId: id, settings: this.get(id), appliesOnNextLaunch: session.live });
    return this.get(id);
  }

  grant(id, origin) {
    const settings = this.get(id);
    return this.configure(id, { enabled: true, allowedOrigins: [...new Set([...settings.allowedOrigins, origin])] });
  }

  async revoke(id) {
    const session = this.sessions.require(id);
    this.configure(id, { enabled: false, allowedOrigins: [] });
    if (session.live) await session.stop();
    this.events.emit({ type: 'revoked', sessionId: id });
  }

  exportPreferences(id) {
    return { compute: { ...this.sessions.require(id).runtimeSettings.compute } };
  }

  dispose() { this.events.dispose(); }
}
