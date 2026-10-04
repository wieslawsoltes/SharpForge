/**
 * The pinned Roslyn region analysis (SF-A02-T35): `pinned.json`, written by tools/pin.mjs, and the content hash that
 * ties each program to its pin, so an edited program with a stale pin is detected.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { markers } from './regions.js';

const root = dirname(fileURLToPath(import.meta.url));

/** The sets of variable names of a data-flow result, in the order they are pinned and compared. */
export const variableSets = Object.freeze([
  'variablesDeclared',
  'readInside',
  'writtenInside',
  'readOutside',
  'writtenOutside',
  'dataFlowsIn',
  'dataFlowsOut',
  'alwaysAssigned',
  'captured',
  'capturedInside',
  'capturedOutside',
]);
/** The facts of a control-flow result. */
export const controlFacts = Object.freeze(['startPointIsReachable', 'endPointIsReachable', 'returnStatements', 'exitPoints', 'entryPoints']);
/** Every pinned key of a region. */
export const resultKeys = Object.freeze([...variableSets, ...controlFacts]);

/** Stable content hash of what Roslyn was shown for a region. */
export function regionHash(region) {
  return createHash('sha256').update(region.source).digest('hex').slice(0, 16);
}

/** The span between the markers of a program: `{start, end}` (the text inside the two comments). */
export function markedSpan(source) {
  const open = source.indexOf(markers.open),
    close = source.indexOf(markers.close);
  if (open < 0 || close < open) throw new Error('the region markers are missing');
  return { start: open + markers.open.length, end: close };
}

/** The pins: `{roslyn, regions: {id: {hash, region: [start, end], ...resultKeys}}}`. */
export function loadPinned() {
  return JSON.parse(readFileSync(join(root, 'pinned.json'), 'utf8'));
}
