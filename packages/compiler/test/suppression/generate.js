/**
 * Regenerates roslyn-suppression.json and roslyn-suppression-end-to-end.json, the pinned Roslyn results of the
 * warning-suppression fixtures (SF-A02-T37).
 * Usage (from the repository root): DOTNET=/path/to/dotnet node packages/compiler/test/suppression/generate.js
 * Uses the same Roslyn oracle as the constants corpus (../constants/roslyn-oracle, mode `suppression`).
 */
import {writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtures} from './fixtures.js';
import {fixtures as endToEndFixtures} from './end-to-end-fixtures.js';
import {runOracle} from '../constants/oracle.js';

const list=rows=>'[\n'+rows.map(r=>'    '+JSON.stringify(r)).join(',\n')+(rows.length?'\n  ]':'  ]');
const rowKeys=['raw','expected','suppressions'];
/** Runs the oracle on a fixture list and writes its pinned results next to this script. */
function pin(fixtureList,fileName){
  const out=runOracle('suppression',{fixtures:fixtureList});
  const field=([key,value])=>`  ${JSON.stringify(key)}:${rowKeys.includes(key)?list(value):JSON.stringify(value)}`;
  const rows=out.fixtures.map(f=>' {\n'+Object.entries(f).map(field).join(',\n')+'\n }');
  const text='{\n"roslyn":'+JSON.stringify(out.roslyn)+',\n"fixtures":[\n'+rows.join(',\n')+'\n]}\n';
  JSON.parse(text);
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)),fileName),text);
  console.log(`pinned ${out.fixtures.length} fixtures from Roslyn ${out.roslyn} in ${fileName}`);
}
pin(fixtures,'roslyn-suppression.json');
// Programs inside the execution profile, replayed through compile() (tests/compiler-suppression-end-to-end.test.js).
pin(endToEndFixtures,'roslyn-suppression-end-to-end.json');
