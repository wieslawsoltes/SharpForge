import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha } from '../../../scripts/conformance/perf/core.js';

export const controlCases = Object.freeze(['Add_0_0', 'Diamond', 'MixedJoin', 'ExistingAuthority',
  'LoadOwner', 'StoreReferenceDerived', 'StringReturn', 'LocalAddressRoundtrip', 'LoadWideInteger']);
export const objectCases = Object.freeze(['NewClass', 'NewArguments', 'BoxValue',
  'HarmlessAnnotation', 'UnboxFieldRead', 'RepeatedConstructor']);

/** Reuse existing emitted fixtures and authorities against the selected checkout's public API. */
export async function verifierBenchmarkWorkload(root, name) {
  const load = relative => import(pathToFileURL(join(root, relative)).href);
  const api = await load('packages/cil/src/index.js');
  const sources = ['packages/cil/src/index.js', 'tests/managed-fixtures.js'];
  const fixtureModule = async relative => {
    sources.push(relative);
    return load(relative);
  };
  const coreCapture = 'tests/fixtures/a03-type-categories/native.json';
  const core = async () => {
    sources.push(coreCapture);
    const { nativeCategoryInput } = await fixtureModule('tests/fixtures/a03-type-categories/native-input.js');
    return { coreTypes: nativeCategoryInput(JSON.parse(readFileSync(join(root, coreCapture)))).coreAuthority };
  };
  let bytes;
  let method = 0x06000001;
  let options = {};
  let expected = 'verified';
  if (['Add_0_0', 'Diamond', 'MixedJoin'].includes(name)) {
    const { numericFixture, numericCases } = await fixtureModule('tests/fixtures/verifier-numeric/input.js');
    const fixture = numericCases.find(value => value.name === name);
    bytes = numericFixture(fixture);
    expected = fixture.accepted ? 'verified' : 'rejected';
  } else if (name === 'ExistingAuthority') {
    const { coreAuthority, externalFixture } = await fixtureModule('tests/fixtures/a03-type-categories/input.js');
    const fixture = externalFixture(coreAuthority());
    const inspector = fixture.inspect();
    return { name, expected: 'reference', sources, fixtureSHA256: sha(JSON.stringify(fixture.builder.rows)),
      readValue: value => value, run() {
        const types = api.createMetadataVerificationTypeSystem(inspector, { coreTypes: fixture.coreTypes });
        return types.typeCategory(types.resolveType(fixture.tokens.LocalClass).value).value;
      } };
  } else if (['LoadOwner', 'StoreReferenceDerived'].includes(name)) {
    const { fieldFixture, fieldAuthority } = await fixtureModule('tests/fixtures/verifier-fields/input.js');
    const { fieldCases } = await fixtureModule('tests/fixtures/verifier-fields/cases.js');
    const input = fieldFixture(fieldCases.find(value => value.name === name));
    ({ bytes, method } = input);
    options = { coreTypes: fieldAuthority(await core(), input) };
  } else if (name === 'StringReturn') {
    const { literalFixture } = await fixtureModule('tests/fixtures/verifier-literals/input.js');
    const { literalCases } = await fixtureModule('tests/fixtures/verifier-literals/cases.js');
    sources.push('tests/fixtures/verifier-fields/input.js');
    ({ bytes, method } = literalFixture(literalCases.find(value => value.name === name)));
  } else if (['LocalAddressRoundtrip', 'LoadWideInteger'].includes(name)) {
    const { memoryFixture, memoryCases } = await fixtureModule('tests/fixtures/verifier-memory/input.js');
    const fixture = memoryCases.find(value => value.name === name);
    bytes = memoryFixture(fixture);
    expected = fixture.status;
  } else if (objectCases.includes(name)) {
    const { objectCase, prepareObject } = await fixtureModule('tests/helpers/object-verifier.js');
    sources.push('tests/fixtures/verifier-object-model/input.js', 'tests/fixtures/verifier-object-model/cases.js',
      'tests/fixtures/verifier-fields/input.js', 'tests/fixtures/a03-type-categories/native-input.js', coreCapture);
    const fixture = name === 'RepeatedConstructor' ? { name, body(writer, input) {
      for (let index = 0; index < 128; index++) writer.op('newobj', input.constructors.Owner).op('pop');
      writer.op('ret');
    } } : objectCase(name);
    const prepared = prepareObject(fixture);
    return { name, expected, sources, fixtureSHA256: sha(prepared.input.bytes),
      readValue: value => value.status,
      run: () => api.verifyCilMethodTypes(prepared.inspector, prepared.input.method, prepared.options) };
  } else {
    throw new Error(`Unknown verifier benchmark workload: ${name}`);
  }
  const inspector = new api.AssemblyInspector(bytes);
  return { name, expected, sources, fixtureSHA256: sha(bytes), readValue: value => value.status,
    run: () => api.verifyCilMethodTypes(inspector, method, options) };
}
