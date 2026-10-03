import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { oracleRoot, readJSON, sha256 } from './toolchain.js';

export const compileOptions = Object.freeze({ target: 'exe', assemblyName: 'Oracle', debug: 'none', pathMap: '/_/oracle', optimize: true, deterministic: true, nullable: 'disable', checked: false, targetFramework: 'net10.0' });

export async function loadFixture(definition, directory = path.join(oracleRoot, 'sources')) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(definition.id)) throw new Error('Invalid fixture id');
  if (!/^[A-Za-z0-9_-]+\.cs$/.test(definition.source)) throw new Error('Fixture source must be a simple .cs filename');
  if (!['11.0', '12.0'].includes(definition.langVersion)) throw new Error('Unpinned LangVersion');
  const sourcePath = path.join(directory, definition.source);
  if (path.dirname(await realpath(sourcePath)) !== await realpath(directory)) throw new Error('Fixture source escapes through a symlink');
  const source = await readFile(sourcePath);
  const inputHash = sha256(JSON.stringify({ sourceName: definition.source, sourceSHA256: sha256(source), langVersion: definition.langVersion, ...compileOptions }));
  return { ...definition, sourceBytes: source, inputHash };
}

export async function loadFixtures() {
  const catalog = await readJSON(path.join(oracleRoot, 'fixtures.json'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.fixtures)) throw new Error('Invalid fixture catalog');
  if (new Set(catalog.fixtures.map(value => value.id)).size !== catalog.fixtures.length) throw new Error('Duplicate fixture ids');
  for (const fixture of catalog.fixtures) {
    if (typeof fixture.execute !== 'boolean') throw new Error(`Missing execution policy for ${fixture.id}`);
    if (fixture.execute) {
      if (typeof fixture.stdout !== 'string' || (typeof fixture.unhandledException !== 'string' && (!Number.isInteger(fixture.exitCode) || fixture.exitCode < -2147483648 || fixture.exitCode > 2147483647))) throw new Error(`Invalid runtime contract for ${fixture.id}`);
    } else if (!Array.isArray(fixture.diagnostics) || !fixture.diagnostics.length || fixture.diagnostics.some(id => !/^CS[0-9]{4}$/.test(id))) throw new Error(`Invalid compiler contract for ${fixture.id}`);
  }
  const fixtures = await Promise.all(catalog.fixtures.map(value => loadFixture(value)));
  if (new Set(fixtures.map(value => value.inputHash)).size !== fixtures.length) throw new Error('Duplicate fixture hashes would alias expected-store entries');
  return fixtures;
}
