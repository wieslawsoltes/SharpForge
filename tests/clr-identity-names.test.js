import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyName, AssemblyLoadError, LoadErrorCode, normalizeAssemblyIdentity } from '../packages/clr/src/index.js';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/assembly-names.json', import.meta.url)));
const hasCode = code => error => error instanceof AssemblyLoadError && error.code === code;

test('CLR AssemblyName agrees with the recorded .NET 10.0.5 display-name corpus', async () => {
  assert.ok(oracle.cases.filter(row => !row.error).length >= 100);
  for (const fixture of oracle.cases) {
    if (fixture.error) {
      assert.throws(() => AssemblyName.parse(fixture.input), hasCode(LoadErrorCode.InvalidName), fixture.input);
      continue;
    }
    const actual = await normalizeAssemblyIdentity(fixture.input);
    assert.equal(actual.name, fixture.name, fixture.input);
    assert.equal(actual.version?.join('.') ?? null, fixture.version, fixture.input);
    assert.equal(actual.culture, fixture.culture, fixture.input);
    assert.equal(actual.publicKeyToken, fixture.token, fixture.input);
    assert.equal(actual.contentType, fixture.contentType, fixture.input);
    assert.equal(actual.fullName, fixture.fullName, fixture.input);
    assert.equal(AssemblyName.parse(actual.fullName).fullName, actual.fullName);
  }
});

