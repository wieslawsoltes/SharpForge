import { GitError } from './errors.js';
import { validateRefName } from './refs/names.js';

function validatePattern(pattern, allowHead = false) {
  if (allowHead && pattern === 'HEAD') return;
  const count = (pattern.match(/\*/g) ?? []).length;
  if (count > 1) throw new GitError('Unsafe', 'Refspec contains more than one wildcard');
  validateRefName(pattern.replace('*', 'wildcard'));
}

/** Parse positive/negative fetch or push refspecs, preserving force intent without authorizing it. */
export function parseRefspec(value, { push = false } = {}) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f]/.test(value)) throw new GitError('Unsafe', 'Invalid refspec');
  let text = value;
  const force = text.startsWith('+');
  if (force) text = text.slice(1);
  const negative = text.startsWith('^');
  if (negative) text = text.slice(1);
  const fields = text.split(':');
  if (fields.length > 2 || (negative && (force || fields.length !== 1 || push))) throw new GitError('Unsafe', 'Invalid negative refspec');
  const source = fields[0];
  const destination = fields.length === 2 ? fields[1] : null;
  if (!source && !(push && destination)) throw new GitError('Unsafe', 'Fetch refspec source is empty');
  if (source) validatePattern(source, true);
  if (destination) validatePattern(destination);
  const sourceWildcard = source.includes('*');
  const destinationWildcard = destination?.includes('*') ?? false;
  if (!negative && sourceWildcard !== destinationWildcard) throw new GitError('Unsafe', 'Refspec wildcards must occur on both sides');
  return { raw: value, force, negative, source, destination, wildcard: sourceWildcard };
}

export function matchRefspec(pattern, name) {
  const wildcard = pattern.indexOf('*');
  if (wildcard < 0) return pattern === name ? '' : null;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (!name.startsWith(prefix) || !name.endsWith(suffix) || name.length < prefix.length + suffix.length) return null;
  return name.slice(prefix.length, name.length - suffix.length);
}

/** Map source references through ordered refspecs; exclusions are applied to every positive mapping. */
export function mapFetchRefs(refs, refspecs) {
  const specs = refspecs.map(value => typeof value === 'string' ? parseRefspec(value) : value);
  const excluded = specs.filter(spec => spec.negative);
  const mappings = new Map();
  for (const ref of refs) {
    if (!ref.oid || ref.name.endsWith('^{}') || excluded.some(spec => matchRefspec(spec.source, ref.name) !== null)) continue;
    for (const spec of specs) {
      if (spec.negative) continue;
      const matched = matchRefspec(spec.source, ref.name);
      if (matched === null) continue;
      const destination = spec.destination?.replace('*', matched) ?? null;
      if (destination && mappings.has(destination) && mappings.get(destination).oid !== ref.oid) {
        throw new GitError('Conflict', 'Multiple remote refs map to one local reference', { destination });
      }
      mappings.set(destination ?? ref.name, { source: ref.name, destination, oid: ref.oid, force: spec.force });
    }
  }
  return [...mappings.values()];
}

/** Compute only tracking refs owned by the configured positive mappings and missing upstream. */
export function prunableRefs(localRefs, remoteRefs, refspecs) {
  const specs = refspecs.map(value => typeof value === 'string' ? parseRefspec(value) : value);
  const upstream = new Set(remoteRefs.map(ref => ref.name));
  return localRefs.filter(ref => specs.some(spec => {
    if (spec.negative || !spec.destination) return false;
    const matched = matchRefspec(spec.destination, ref.name);
    if (matched === null) return false;
    const source = spec.source.replace('*', matched);
    if (specs.some(negative => negative.negative && matchRefspec(negative.source, source) !== null)) return false;
    return !upstream.has(source);
  }));
}
