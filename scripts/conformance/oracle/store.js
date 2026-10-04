import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, pin, platform, readJSON, requireTarget } from './toolchain.js';
import { loadFixtures } from './fixtures.js';
import { winuiInput } from './winui-run.js';
import { loadBclExpectedFixtures, validateBclExpectedResult } from './bcl-expected-fixtures.js';

export const expectedRoot = path.join(root, 'tests/conformance/expected');
const schema = await readJSON(path.join(root, 'planning/qualification/expected.schema.json'));

// The checked-in schema deliberately uses this small, validated JSON Schema subset.
// Unknown assertion keywords fail closed so extending the schema cannot silently weaken validation.
export function validateSchema(value, rule = schema, pointer = '$') {
  const known = new Set(['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'anyOf', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'pattern']);
  for (const key of Object.keys(rule)) if (!known.has(key)) throw new Error(`Unsupported schema assertion ${key}`);
  const fail = message => { throw new Error(`${pointer}: ${message}`); };
  if ('const' in rule && value !== rule.const) fail('const mismatch');
  if (rule.enum && !rule.enum.includes(value)) fail('enum mismatch');
  for (const choice of ['anyOf', 'oneOf']) if (rule[choice]) {
    const matches = rule[choice].filter(candidate => { try { validateSchema(value, candidate, pointer); return true; } catch { return false; } }).length;
    if (matches === 0 || (choice === 'oneOf' && matches !== 1)) fail(`${choice} mismatch`);
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (rule.type && !(rule.type === 'integer' ? Number.isSafeInteger(value) : type === rule.type)) fail(`expected ${rule.type}`);
  if (typeof value === 'number' && (value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))) fail('number out of bounds');
  if (typeof value === 'string') {
    if (value.length < (rule.minLength ?? 0)) fail('string too short');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('pattern mismatch');
  }
  if (Array.isArray(value)) {
    if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) fail('array length out of bounds');
    if (rule.items) value.forEach((item, i) => validateSchema(item, rule.items, `${pointer}[${i}]`));
  }
  if (type === 'object') {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (rule.properties?.[key]) validateSchema(item, rule.properties[key], `${pointer}.${key}`);
      else if (rule.additionalProperties === false) fail(`unknown ${key}`);
    }
  }
  return true;
}

export const versions = { roslyn: pin.roslyn.version, coreclr: pin.runtime, winui: pin.windowsAppSDK };
export function envelope(oracleId, fixture, result, target = platform) {
  return {
    schemaVersion: 1, fixtureId: fixture.id, inputHash: fixture.inputHash, oracleId,
    toolVersion: versions[oracleId], target,
    toolchain: { sdk: pin.sdk, runtime: pin.runtime, roslyn: pin.roslyn.version, referencePack: pin.referencePack, windowsAppSDK: oracleId === 'winui' ? pin.windowsAppSDK : null },
    langVersion: fixture.langVersion ?? null, result,
  };
}

export function expectedPath(entry, directory = expectedRoot) {
  validateSchema(entry);
  return path.join(directory, entry.oracleId, encodeURIComponent(entry.toolVersion), entry.target, `${entry.inputHash}.json`);
}

export async function writeExpected(entry, directory = expectedRoot) {
  const file = expectedPath(entry, directory);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`);
  return file;
}

export async function compareExpected(entry, directory = expectedRoot) {
  const file = expectedPath(entry, directory);
  let actual;
  try { actual = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Missing or invalid expected output ${path.relative(root, file)}: ${error.message}`); }
  validateSchema(actual);
  if (JSON.stringify(actual) !== JSON.stringify(entry)) throw new Error(`Oracle expected output mismatch: ${path.relative(root, file)}`);
}

export async function verifyEntry(entry, fixtures, file) {
  validateSchema(entry);
  const fixture = entry.oracleId === 'winui' ? await winuiInput() : fixtures.find(item => item.id === entry.fixtureId);
  if (!fixture || fixture.id !== entry.fixtureId) throw new Error(`Unknown fixture ${entry.fixtureId}`);
  if (fixture.oracleId && fixture.oracleId !== entry.oracleId) throw new Error(`Wrong oracle for ${entry.fixtureId}`);
  if (fixture.inputHash !== entry.inputHash) throw new Error(`Stale input hash for ${entry.fixtureId}: expected ${fixture.inputHash}, found ${entry.inputHash}`);
  if (entry.toolVersion !== versions[entry.oracleId]) throw new Error(`Stale tool version for ${entry.fixtureId}`);
  if (JSON.stringify(entry.toolchain) !== JSON.stringify(envelope(entry.oracleId, fixture, entry.result).toolchain)) throw new Error(`Stale toolchain for ${entry.fixtureId}`);
  if (entry.langVersion !== (fixture.langVersion ?? null)) throw new Error(`LangVersion mismatch for ${entry.fixtureId}`);
  const resultKeys = Object.keys(entry.result);
  const discriminator = { roslyn: 'diagnostics', coreclr: 'unhandledException', winui: 'dispatcherOrder' }[entry.oracleId];
  if (!resultKeys.includes(discriminator)) throw new Error(`Wrong result shape for ${entry.oracleId}`);
  if (!requireTarget(entry.oracleId, entry.target).supported) throw new Error('Evidence target is unsupported by the pinned harness');
  if (entry.oracleId === 'coreclr' && !fixture.execute) throw new Error('Compile-negative fixtures cannot have CoreCLR execution evidence');
  if (fixture.culture) validateBclExpectedResult(fixture, entry.result);
  if (file && path.normalize(file).split(path.sep).slice(-4).join('/') !== expectedPath(entry).split(path.sep).slice(-4).join('/')) throw new Error(`Expected store path/key mismatch: ${file}`);
  return true;
}

export async function verifyStore(directory = expectedRoot) {
  const fixtures = [...await loadFixtures(), ...await loadBclExpectedFixtures()];
  const files = [];
  const visit = async current => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isSymbolicLink()) throw new Error(`Expected store must not contain symlinks: ${file}`);
      if (item.isDirectory()) await visit(file);
      else if (item.name.endsWith('.json')) files.push(file);
    }
  };
  await visit(directory);
  if (!files.length) throw new Error('Expected store is empty');
  for (const file of files) await verifyEntry(await readJSON(file), fixtures, file);
  return { entries: files.length };
}
