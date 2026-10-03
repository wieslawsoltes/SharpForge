import { diagnostic } from '@sharpforge/text';
import { languageFeature, featureNotAvailableCode } from './features.js';
import { parseLanguageVersion, displayLanguageVersion } from './langversion.js';
import { previewRevisions } from './preview-revisions.js';
/** Parser-side feature availability: maps a feature use and a target LangVersion to Roslyn's "feature not available" diagnostics. */
const resolve = version => (typeof version === 'object' && version ? version : (parseLanguageVersion(version) ?? parseLanguageVersion('default')));
/**
 * Returns { code, message } when `featureId` is unavailable at `version`, otherwise null.
 * Released features report CS8022-CS8026, CS8059, CS8107, CS8302, CS8320, CS8370, CS8400, CS8773, CS8936, CS9058,
 * CS9202 or CS9260 according to the selected version; preview features report CS8652 with their pinned revision.
 */
export function featureAvailability(featureId, version) {
  const feature = languageFeature(featureId),
    selected = resolve(version);
  if (!feature) throw new Error(`Unknown language feature '${featureId}'`);
  if (feature.preview) {
    if (selected.preview) return null;
    const stamp = previewRevisions[feature.id];
    const pinned = stamp ? ` (pinned to ${stamp.proposal} revision ${stamp.revision}, ${stamp.sdk})` : '';
    const advice = "To use Preview features, use the 'preview' language version.";
    return { code: 'CS8652', message: `The feature '${feature.name}' is currently in Preview and *unsupported*. ${advice}${pinned}` };
  }
  if (selected.number >= feature.version) return null;
  const selectedName = displayLanguageVersion(selected.number);
  const requiredName = displayLanguageVersion(feature.version);
  return {
    code: featureNotAvailableCode(selected.number),
    message: `Feature '${feature.name}' is not available in C# ${selectedName}. Please use language version ${requiredName} or greater.`
  };
}
/**
 * Checks one feature use. `node` is anything with a span: a red node or token, or { start, end }.
 * Returns { code, message, start, end } or null when the feature is available.
 */
export function checkFeature(node, featureId, version) {
  const result = featureAvailability(featureId, version);
  if (!result) return null;
  const span = node.span ?? node;
  return { ...result, start: span.start, end: span.end };
}
/** Checks the feature uses recorded by the lexer and parser ({ id, start, end }) and returns diagnostics for `source`. */
export function checkFeatures(source, uses, version) {
  const selected = resolve(version),
    seen = new Set(),
    diagnostics = [];
  for (const use of uses) {
    const result = featureAvailability(use.id, selected),
      key = use.id + ':' + use.start;
    if (!result || seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic(source, use.start, Math.max(1, use.end - use.start), result.code, result.message));
  }
  return diagnostics;
}
