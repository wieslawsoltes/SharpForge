/**
 * The conversion classification corpus (SF-A02-T06.1): source/target pairs whose classification is pinned from
 * Roslyn (`Compilation.ClassifyConversion` for type pairs, `SemanticModel.ClassifyConversion` for expressions) and
 * replayed through conversions/classify.js by tests/compiler-conversion-corpus.test.js.
 *
 * Categories covered (type-pairs.js, expression-pairs.js):
 *   identity; implicit and explicit numeric (the full 12 x 12 matrix of simple types, nint/nuint as numeric types);
 *   nullable wrapping, lifted and unwrapping conversions; enumeration conversions; reference conversions between
 *   classes, interfaces, arrays (covariance, array to collection interfaces), delegates and variant generic
 *   interfaces and delegates; boxing and unboxing; type parameters with and without constraints; tuples (element-wise
 *   implicit and explicit, names, nullable tuples, nesting); user-defined implicit and explicit operators with their
 *   standard pre- and post-conversions and lifted forms; span conversions (C# 14 first-class spans, and the same
 *   pairs at C# 13 through the span types' operators); and from expressions: the null and default literals, constant
 *   expressions (implicit constant conversion, 0 to enum, out-of-range constants), typed values, anonymous functions,
 *   method groups, interpolated strings, tuple literals, target-typed `new()` and collection expressions.
 * Not covered: `dynamic`, pointers and function pointers, and BCL types the closed registry does not model.
 *
 * Regenerate pinned.json with generate-roslyn-conversions.js after changing a pair.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSource } from './prelude.js';
import { typePairCategories, csharp13TypePairs } from './type-pairs.js';
import { expressionPairCategories } from './expression-pairs.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Path of the pinned Roslyn classifications. */
export const pinnedPath = join(here, 'pinned.json');

/** Flattens `{ category: [[a, b], ...] }` into `[{ category, source, target }]`. */
function flatten(categories) {
  return Object.entries(categories).flatMap(([category, pairs]) => pairs.map(([source, target]) => ({ category, source, target })));
}

/**
 * One compilation of the corpus: its language version, the C# source both compilers bind, the distinct types (by
 * parameter index) and the pairs as indices into them.
 */
function compilation(langVersion, typePairs, expressionPairs) {
  const types = [];
  const indexOf = type => {
    const found = types.indexOf(type);
    return found >= 0 ? found : types.push(type) - 1;
  };
  const typeRows = typePairs.map(pair => ({ ...pair, from: indexOf(pair.source), to: indexOf(pair.target) }));
  const expressionRows = expressionPairs.map(pair => ({ ...pair, to: indexOf(pair.target) }));
  const source = buildSource(
    types,
    expressionRows.map(row => row.source),
  );
  return { langVersion, source, types, typePairs: typeRows, expressions: expressionRows };
}

/** The corpus as the list of compilations (default language version, then C# 13). */
export function loadCorpus() {
  return [
    compilation(null, flatten(typePairCategories), flatten(expressionPairCategories)),
    compilation('13', flatten(csharp13TypePairs), []),
  ];
}

/** Total number of pairs in a corpus. */
export const pairCount = corpus => corpus.reduce((total, unit) => total + unit.typePairs.length + unit.expressions.length, 0);

/** Content hash of everything Roslyn was shown, so that a stale pinned.json is detected. */
export function corpusHash(corpus) {
  const hash = createHash('sha256');
  for (const unit of corpus) {
    hash.update(`${unit.langVersion ?? ''}\0${unit.source}\0`);
    hash.update(JSON.stringify([unit.typePairs.map(row => [row.from, row.to]), unit.expressions.map(row => row.to)]));
  }
  return hash.digest('hex').slice(0, 16);
}

/** The pinned Roslyn classifications: `{ roslyn, hash, compilations: [{ langVersion, typePairs, expressions }] }`. */
export function loadPinned() {
  return JSON.parse(readFileSync(pinnedPath, 'utf8'));
}
