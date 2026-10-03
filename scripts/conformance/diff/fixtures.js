import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validate} from '../../planning/schema/validate.js';
export const root=fileURLToPath(new URL('../../../',import.meta.url));
export const corpusRoot=path.join(root,'tests/conformance/differential');
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const schema=JSON.parse(await readFile(path.join(corpusRoot,'README-format.json'),'utf8'));
export const defaults=Object.freeze({timeoutMs:10000,maxInstructions:1000000,maxOutputBytes:65536,maxFrames:128,maxHeapBytes:16*1024*1024});
export function limits(value={}){for(const [key,number]of Object.entries(value))if(!(key in defaults)||!Number.isSafeInteger(number)||number<1||number>2147483647)throw new Error('Invalid differential limit '+key);return {...defaults,...value};}
export function fixtureHash(fixture){return sha256(JSON.stringify({source:fixture.sourceText,entry:fixture.entry,stdin:fixture.stdin,capabilities:fixture.capabilities,seed:fixture.seed,normalisers:fixture.normalisers,langVersion:fixture.langVersion,limits:fixture.limits}));}
export function validateDefinition(definition){validate(schema,definition);return definition;}
export function hydrateFixture(definition,sourceText){
  validateDefinition(definition);
  if(Buffer.byteLength(sourceText)>1024*1024)throw new Error('Fixture source exceeds 1 MiB');
  // Conservative scan intentionally also rejects suspicious comments until tagged.
  if(/\b(?:DateTime\s*\.\s*(?:UtcNow|Now|Today)|Environment\s*\.\s*TickCount(?:64)?|Stopwatch|GetTimestamp)\b/.test(sourceText)&&!definition.normalisers.includes('wall-clock'))throw new Error('Wall-clock use requires wall-clock normaliser tag');
  if(/\b(?:Dictionary|HashSet|ConcurrentDictionary|Hashtable)\b/.test(sourceText)&&!definition.normalisers.includes('unordered-lines'))throw new Error('Unordered iteration requires unordered-lines normaliser tag');
  if(/\b(?:Random\s*\(\s*\)|Random\s*\.\s*Shared\b|Guid\s*\.\s*NewGuid\b)/.test(sourceText))throw new Error('Unseeded randomness is outside the deterministic fixture profile');
  const fixture={...definition,sourceText:sourceText.replaceAll('{{seed}}',String(definition.seed)),limits:limits(definition.limits)};
  return {...fixture,inputHash:fixtureHash(fixture)};
}
export async function loadFixture(definition,directory=corpusRoot){
  validateDefinition(definition);const base=await realpath(directory),source=await realpath(path.resolve(base,definition.source));
  if(!source.startsWith(base+path.sep))throw new Error('Fixture source escapes corpus directory');
  return hydrateFixture(definition,await readFile(source,'utf8'));
}
export async function loadCorpus(file=path.join(corpusRoot,'corpus.json')){
  const catalog=JSON.parse(await readFile(file,'utf8'));
  if(catalog.schemaVersion!==1||!Array.isArray(catalog.fixtures)||!catalog.fixtures.length||Object.keys(catalog).some(k=>!['schemaVersion','fixtures'].includes(k)))throw new Error('Malformed differential corpus');
  if(new Set(catalog.fixtures.map(f=>f.id)).size!==catalog.fixtures.length)throw new Error('Duplicate fixture identity');
  return Promise.all(catalog.fixtures.map(f=>loadFixture(f,path.dirname(file))));
}
