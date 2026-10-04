import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {release} from 'node:os';
import {createHostStringOrdering} from '@sharpforge/bcl-core';

const reference = JSON.parse(await readFile(new URL('../reference/culture-ordering-net10.json', import.meta.url), 'utf8'));
const boundaries = JSON.parse(await readFile(new URL('../reference/culture-ordering-boundaries-net10.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../reference/culture-ordering-boundaries/Program.cs', import.meta.url));
if (createHash('sha256').update(source).digest('hex') !== boundaries.sourceSha256) {
  throw new Error('Native boundary reference does not match its capture source');
}
const provider = createHostStringOrdering();
const decode = units => units === null ? null : String.fromCharCode(...units);
const values = reference.values.map(decode);

function compareCorpus() {
  let comparisons = 0;
  let mismatchCount = 0;
  const mismatches = [];
  for (let first = 0; first < values.length; first++) {
    for (let second = 0; second < values.length; second++) {
      const expected = reference.invariant.signs[first][second];
      const actual = provider.compare(values[first], values[second]);
      comparisons++;
      if (actual === expected) continue;
      mismatchCount++;
      if (mismatches.length < 100) mismatches.push({first, second, left: reference.values[first],
        right: reference.values[second], expected, actual});
    }
  }
  return {values: values.length, comparisons, mismatchCount, mismatches, diagnosticLimit: 100};
}

const corpus = compareCorpus();
const boundaryResults = boundaries.pairs.map(row => {
  const first = decode(row.left);
  const second = decode(row.right);
  return {id: row.id, left: row.left, right: row.right, expected: row.sign, actual: provider.compare(first, second),
    reverseExpected: row.reverseSign, reverseActual: provider.compare(second, first)};
});
const boundaryMismatches = boundaryResults.reduce((count, row) => count +
  Number(row.actual !== row.expected) + Number(row.reverseActual !== row.reverseExpected), 0);

console.log(JSON.stringify({
  schemaVersion: 1,
  host: {node: process.version, v8: process.versions.v8, icu: process.versions.icu ?? null,
    cldr: process.versions.cldr ?? null, unicode: process.versions.unicode ?? null,
    platform: process.platform, architecture: process.arch, release: release()},
  provider: provider.info,
  native: {runtime: reference.runtime, sdk: reference.sdk, os: reference.os,
    architecture: reference.architecture, sortVersion: reference.sortVersion},
  nativeBoundaries: {runtime: boundaries.runtime, sdk: boundaries.sdk, os: boundaries.os,
    sortVersion: boundaries.sortVersion, sourceSha256: boundaries.sourceSha256},
  corpus,
  boundaries: {comparisons: boundaryResults.length * 2, mismatchCount: boundaryMismatches, results: boundaryResults},
  qualification: 'Finite native regression data for this host; not universal .NET collation parity.'
}, null, 2));
if (corpus.mismatchCount || boundaryMismatches) process.exitCode = 1;
