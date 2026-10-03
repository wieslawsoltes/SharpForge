/**
 * Regenerates roslyn-constants.json, the pinned Roslyn results of the constant-folding differential corpus.
 * Usage (from the repository root): DOTNET=/path/to/dotnet node packages/compiler/test/constants/generate.js
 * Row shapes: {expression,checked,type,value[,bits]} for a constant, {expression,checked,type,constant:false} for a
 * valid non-constant expression, {expression,checked,diagnostics:[ids],messages:[text]} when Roslyn reports errors.
 * Integers, chars (UTF-16 code unit) and decimals are pinned as invariant strings; float/double also pin their IEEE
 * bits (hex) and decimal its System.Decimal.GetBits words, which is what the test compares.
 */
import {writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prelude,cases} from './expressions.js';
import {runOracle} from './oracle.js';

const out=runOracle('constants',{prelude,cases:cases()});
const text='{\n"roslyn":'+JSON.stringify(out.roslyn)+',\n"prelude":'+JSON.stringify(out.prelude)+',\n"enums":'+JSON.stringify(out.enums)+',\n"rows":[\n'+out.rows.map(r=>JSON.stringify(r)).join(',\n')+'\n]}\n';
writeFileSync(join(dirname(fileURLToPath(import.meta.url)),'roslyn-constants.json'),text);
console.log(`pinned ${out.rows.length} rows from Roslyn ${out.roslyn}`);
