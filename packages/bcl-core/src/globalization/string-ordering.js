import {fail} from '../host.js';

const providers = new WeakMap();
const options = Object.freeze({
  localeMatcher: 'lookup', usage: 'sort', sensitivity: 'variant',
  numeric: false, caseFirst: 'false', ignorePunctuation: false
});

function unavailable(message, cause) {
  const error = new Error(message, {cause});
  error.name = 'NotSupportedException';
  throw error;
}

/** Create the host-normalized English/root profile; this is not a pinned ICU implementation. */
export function createHostStringOrdering({Collator = globalThis.Intl?.Collator} = {}) {
  if (typeof Collator !== 'function' || typeof Collator.supportedLocalesOf !== 'function') {
    unavailable('Default string ordering requires Intl.Collator with English standard collation');
  }
  let collator;
  let resolved;
  try {
    if (!Collator.supportedLocalesOf(['en'], {localeMatcher: 'lookup'}).includes('en')) {
      unavailable('The host does not support English standard collation');
    }
    // CLDR English inherits root collation. "und" can instead select the host's default locale.
    collator = new Collator('en', options);
    resolved = collator.resolvedOptions();
  } catch (error) {
    if (error.name === 'NotSupportedException') throw error;
    unavailable('The host could not initialize default string ordering', error);
  }
  if (resolved.locale !== 'en' && !resolved.locale?.startsWith('en-') || resolved.collation !== 'default' ||
      resolved.usage !== 'sort' || resolved.sensitivity !== 'variant' || resolved.numeric !== false ||
      resolved.caseFirst !== 'false' || resolved.ignorePunctuation !== false) {
    unavailable('The host did not resolve the required English standard collation options');
  }
  const compare = collator.compare;
  const info = Object.freeze({backend: 'Intl.Collator', profile: 'invariant-host', requestedLocale: 'en',
    resolvedOptions: Object.freeze({...resolved})});
  return Object.freeze({info, compare(first, second) {
    if (first !== null && typeof first !== 'string' || second !== null && typeof second !== 'string') {
      throw new TypeError('String ordering requires nullable strings');
    }
    if (first === second) return 0;
    if (first === null) return -1;
    if (second === null) return 1;
    const order = compare(first, second);
    return order < 0 ? -1 : order > 0 ? 1 : 0;
  }});
}

/** Reuse one host provider per platform; no comparer handles enter managed snapshots. */
export function defaultStringOrdering(platform) {
  let provider = providers.get(platform);
  if (!provider) {
    try { provider = createHostStringOrdering(); }
    catch (error) { fail(platform, 'NotSupportedException', error.message); }
    providers.set(platform, provider);
  }
  return provider;
}
