import {findTextMatches} from '@sharpforge/text';
import {cancellable} from '../workbench/events.js';

const sameWorkspace = (left, right) => left.identity === right.identity && left.revision === right.revision &&
  left.disk === right.disk && left.provider === right.provider;
const versionOf = record => record?.version ?? 0;

function snapshot(context) {
  return {identity: context.identity, revision: context.revision, disk: context.disk, provider: context.provider};
}

function matchesSpan(text, match, query, options) {
  if (typeof text !== 'string' || !Number.isSafeInteger(match.start) || !Number.isSafeInteger(match.end) ||
      match.start < 0 || match.end <= match.start || match.end > text.length || match.end - match.start > 2048) return false;
  const span = text.slice(match.start, match.end);
  const found = findTextMatches([{uri: match.uri, text: span}], query, {matchCase: options.matchCase, maxMatches: 1}).matches[0];
  if (!found || found.start !== 0 || found.end !== span.length) return false;
  if (!options.wholeWord) return true;
  let before = match.start - 1;
  if (before > 0 && text.charCodeAt(before) >= 0xdc00 && text.charCodeAt(before) <= 0xdfff) before--;
  const previous = text.slice(Math.max(0, before), match.start);
  const next = match.end < text.length ? String.fromCodePoint(text.codePointAt(match.end)) : '';
  return !/[\p{L}\p{N}\p{M}_]/u.test(previous) && !/[\p{L}\p{N}\p{M}_]/u.test(next);
}

/** Bind provider/compiler search results to one workspace and query; only guarded lazy admission may advance their versions. */
export class WorkspaceSearchController {
  constructor({context, request, load, open, show}) {
    this.host = {context, request, load, open, show};
    this.generation = 0;
    this.navigation = 0;
    this.requestAbort = null;
    this.navigationAbort = null;
    this.before = null;
    this.result = null;
    this.disposed = false;
  }

  capture() {
    return {...snapshot(this.host.context()), generation: this.generation};
  }

  isCurrent(intent) {
    return !this.disposed && intent.generation === this.generation && sameWorkspace(intent, this.host.context());
  }

  sameIdentity(intent) {
    const current = this.host.context();
    return !this.disposed && current.identity === intent.identity && current.disk === intent.disk && current.provider === intent.provider;
  }

  observe() {
    if (!this.before || this.disposed || sameWorkspace(this.before, this.host.context())) return;
    this.stale('Workspace changed. Search again to refresh these results.');
  }

  stopPending() {
    this.requestAbort?.abort();
    this.navigationAbort?.abort();
    this.requestAbort = null;
    this.navigationAbort = null;
    this.navigation++;
  }

  stale(message) {
    this.stopPending();
    this.generation++;
    this.before = null;
    this.result = null;
    if (!this.disposed) this.host.show({kind: 'stale', message});
    return null;
  }

  cancel() {
    return this.stale('Search cancelled. Search again when ready.');
  }

  async search(query, options = {}) {
    if (this.disposed) return null;
    this.stopPending();
    const generation = ++this.generation;
    const controller = this.requestAbort = new AbortController();
    const context = this.host.context();
    this.before = snapshot(context);
    this.result = null;
    const versions = new Map(context.records.map(record => [record.path, {version: versionOf(record), lazy: !!record.lazy}]));
    const before = this.before;
    const settings = {matchCase: !!options.matchCase, wholeWord: !!options.wholeWord};
    this.host.show({kind: 'searching', message: 'Searching…'});
    try {
      const result = await cancellable(this.host.request('findInFiles', {query, options: settings, signal: controller.signal}), controller.signal);
      if (this.disposed || generation !== this.generation) return null;
      if (!sameWorkspace(before, this.host.context())) return this.stale('Workspace changed. Search again to refresh these results.');
      const matches = result.matches.map(match => ({...match, version: match.version ?? versions.get(match.uri)?.version ?? 0}));
      const binding = {query, options: settings, matches, truncated: result.truncated, before, generation, versions};
      this.result = binding;
      this.host.show({kind: 'results', result: binding});
      return binding;
    } catch (error) {
      if (this.disposed || generation !== this.generation) return null;
      if (!sameWorkspace(before, this.host.context())) return this.stale('Workspace changed. Search again to refresh these results.');
      this.host.show({kind: 'error', message: error.message ?? String(error)});
      return null;
    } finally {
      if (this.requestAbort === controller) this.requestAbort = null;
    }
  }

  currentNavigation(binding, navigation, signal) {
    return !this.disposed && !signal.aborted && navigation === this.navigation && binding === this.result &&
      binding.generation === this.generation;
  }

  refuseNavigation(message) {
    this.stale(message);
    return false;
  }

  async navigate(binding, index) {
    if (this.disposed || binding !== this.result) return false;
    const match = binding.matches[index];
    if (!match) return false;
    this.navigationAbort?.abort();
    const controller = this.navigationAbort = new AbortController();
    const navigation = ++this.navigation;
    try {
      const context = this.host.context();
      if (!sameWorkspace(binding.before, context)) return this.refuseNavigation('Workspace changed. Search again before opening a result.');
      const record = context.records.find(file => file.path === match.uri);
      const expected = binding.versions.get(match.uri);
      if (!record || !expected || versionOf(record) !== expected.version ||
          !expected.admitted && match.version !== expected.version) {
        return this.refuseNavigation('This document changed or was removed. Search again before opening a result.');
      }
      let loaded = record;
      if (record.lazy) {
        if (!this.host.load) throw new Error('Original file contents are unavailable. Reopen the folder and search again.');
        loaded = await cancellable(this.host.load(match.uri, {signal: controller.signal}), controller.signal);
      }
      if (!this.currentNavigation(binding, navigation, controller.signal)) return false;
      const current = this.host.context();
      const member = current.records.find(file => file.path === match.uri);
      const unchanged = record.lazy ? loaded && member && !member.lazy && versionOf(member) === versionOf(loaded) &&
        versionOf(member) >= expected.version && member.text === loaded.text : member && versionOf(member) === expected.version;
      if (!sameWorkspace(binding.before, current) || !unchanged || !matchesSpan(member?.text, match, binding.query, binding.options)) {
        return this.refuseNavigation('The matched text changed. Search again to find its current location.');
      }
      if (record.lazy) binding.versions.set(match.uri, {version: versionOf(member), lazy: false, admitted: true});
      await this.host.open(match.uri, match.start, match.end);
      return this.currentNavigation(binding, navigation, controller.signal);
    } catch (error) {
      if (!this.currentNavigation(binding, navigation, controller.signal)) return false;
      if (!sameWorkspace(binding.before, this.host.context())) this.stale('Workspace changed. Search again before opening a result.');
      else this.host.show({kind: 'error', message: error.message ?? String(error)});
      return false;
    } finally {
      if (this.navigationAbort === controller) this.navigationAbort = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.stopPending();
    this.generation++;
    this.before = null;
    this.result = null;
  }
}
