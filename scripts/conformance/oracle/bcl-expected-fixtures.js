import { cultures, loadCorpus, parseObservations } from './bcl-run.js';
import { sha256 } from './toolchain.js';

/** One native process result contains all 40 cases for one family and culture. */
export async function loadBclExpectedFixtures(directory) {
  const corpus = await loadCorpus(directory);
  return corpus.flatMap(family => cultures.map(culture => ({
    id: `${family.id}-${culture.toLowerCase()}`, oracleId: 'coreclr', execute: true,
    family: family.family, culture, cases: family.cases, source: family.source,
    langVersion: family.langVersion, familyInputHash: family.inputHash,
    sourceSHA256: family.sourceSHA256, catalogSHA256: family.catalogSHA256,
    inputHash: sha256(JSON.stringify({ familyInputHash: family.inputHash, culture })),
  })));
}

export function validateBclExpectedResult(fixture, result) {
  return parseObservations(result, fixture, fixture.culture);
}
