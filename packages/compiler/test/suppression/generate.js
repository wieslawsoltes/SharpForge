/**
 * Regenerates roslyn-suppression.json, the pinned Roslyn results of the warning-suppression fixtures (SF-A02-T37).
 * Usage (from the repository root): DOTNET=/path/to/dotnet node packages/compiler/test/suppression/generate.js
 * Uses the same Roslyn oracle as the constants corpus (../constants/roslyn-oracle, mode `suppression`).
 */
import {writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtures} from './fixtures.js';
import {runOracle} from '../constants/oracle.js';

const out=runOracle('suppression',{fixtures});
const list=rows=>'[\n'+rows.map(r=>'    '+JSON.stringify(r)).join(',\n')+(rows.length?'\n  ]':'  ]');
const text='{\n"roslyn":'+JSON.stringify(out.roslyn)+',\n"fixtures":[\n'+out.fixtures.map(f=>' {\n'+Object.entries(f).map(([key,value])=>`  ${JSON.stringify(key)}:${['raw','expected','suppressions'].includes(key)?list(value):JSON.stringify(value)}`).join(',\n')+'\n }').join(',\n')+'\n]}\n';
JSON.parse(text);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)),'roslyn-suppression.json'),text);
console.log(`pinned ${out.fixtures.length} fixtures from Roslyn ${out.roslyn}`);
