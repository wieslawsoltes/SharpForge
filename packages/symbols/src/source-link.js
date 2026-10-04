import { fail } from './contracts.js';

function safeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('Invalid Source Link URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    fail('Source Link must use credential-free HTTPS');
  }
  return url.href;
}

function escapedPath(value) {
  try {
    return value
      .split('/')
      .map((part) => {
        if (part === '.' || part === '..') fail('Source Link relative path contains dot segments');
        return encodeURIComponent(part).replace(
          /[!'()*]/g,
          (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
        );
      })
      .join('/');
  } catch (error) {
    if (error instanceof URIError) fail('Invalid Unicode in Source Link document path');
    throw error;
  }
}

/** Resolve a Source Link path without I/O. ignoreCase opts into the spec's ordinal-insensitive matching. */
export function sourceLinkUrl(symbols, documentName, { ignoreCase = false, maxMappings = 10000 } = {}) {
  if (typeof documentName !== 'string' || documentName.length > 32768) fail('Invalid Source Link document path');
  if (typeof ignoreCase !== 'boolean' || !Number.isSafeInteger(maxMappings) || maxMappings < 0) {
    fail('Invalid Source Link mapping options');
  }
  if (documentName.includes('*')) return null;
  const documents = symbols.sourceLink?.documents ?? {};
  if (!documents || typeof documents !== 'object' || Array.isArray(documents)) fail('Invalid Source Link document map');
  const normalize = (value) => value.replaceAll('\\', '/');
  const compare = (value) =>
    ignoreCase
      ? Array.from(value, (character) => {
          const upper = character.toUpperCase();
          return upper.length === character.length ? upper : character;
        }).join('')
      : value;
  const path = normalize(documentName);
  const comparablePath = compare(path);
  const seen = new Set();
  let selected = null;
  let specificity = -1;
  let count = 0;
  for (const [pattern, url] of Object.entries(documents)) {
    if (++count > maxMappings) fail('Source Link mapping limit exceeded');
    if (!pattern || pattern.length > 32768 || typeof url !== 'string' || url.length > 32768) {
      fail('Invalid Source Link mapping');
    }
    const wildcard = pattern.indexOf('*');
    const urlWildcard = url.indexOf('*');
    if (
      (wildcard >= 0 && wildcard !== pattern.length - 1) ||
      wildcard < 0 !== urlWildcard < 0 ||
      (urlWildcard >= 0 && url.indexOf('*', urlWildcard + 1) >= 0)
    ) {
      fail('Invalid Source Link wildcard mapping');
    }
    const normalized = normalize(pattern);
    const comparable = compare(normalized);
    if (seen.has(comparable)) fail('Ambiguous Source Link path mapping');
    seen.add(comparable);
    const prefix = wildcard < 0 ? comparable : comparable.slice(0, -1);
    const matches = wildcard < 0 ? comparablePath === prefix : comparablePath.startsWith(prefix);
    const score = wildcard < 0 ? Infinity : prefix.length;
    if (matches && score > specificity) {
      const relative = wildcard < 0 ? null : path.slice(normalized.length - 1);
      selected = relative === null ? url : url.replace('*', escapedPath(relative));
      specificity = score;
    }
  }
  return selected === null ? null : safeUrl(selected);
}
