import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { probeRoot, readJSON, sha256, counts } from './common.js';
import { runtimeObservations } from './runtime-runner.js';
export async function runtimeInventory(options = {}) {
  const file = path.join(probeRoot, 'runtime.json'), bytes = await readFile(file), catalog = JSON.parse(bytes);
  const observations = await runtimeObservations(catalog.fixtures, options);
  const rows = catalog.fixtures.map(fixture => {
    const results = observations.filter(value=>value.id === fixture.id).map(({ elapsedMs, ...value })=>value);
    return { key:`runtime:${fixture.id}`, domain:'RUNTIME', name:fixture.name, area:fixture.area, specRevision:'dotnet-10.0.5', probe:'tests/conformance/inventory/probes/runtime.json', fixture:fixture.id,
      probeSHA256:sha256(bytes), status:results.every(value=>value.status==='pass')?'implemented':'missing', statusScope:'two independent JS VM assertions on the recorded host only', observations:results };
  });
  return { schemaVersion:1, platform:`node-${process.platform}-${process.arch}`, rows, totals:counts(rows) };
}
