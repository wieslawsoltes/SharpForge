import { readFileSync } from 'node:fs';
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { nativeCategoryInput } from '../fixtures/a03-type-categories/native-input.js';
import { objectFixture, objectAuthority, objectAnnotations } from '../fixtures/verifier-object-model/input.js';
import { objectCases } from '../fixtures/verifier-object-model/cases.js';

const capture = JSON.parse(readFileSync(new URL('../fixtures/a03-type-categories/native.json', import.meta.url), 'utf8'));
const native = nativeCategoryInput(capture);
const strings = native.coreInspector.metadata.streams.get('#Strings');
const decoder = new TextDecoder();
const text = offset => decoder.decode(strings.subarray(offset, strings.indexOf(0, offset)));
const externalTypes = new Map();
for (const [index, row] of native.coreInspector.metadata.rows[2].entries()) {
  const name = text(row[2]) + '.' + text(row[1]);
  if (name === 'System.Exception' || name === 'System.MulticastDelegate')
    externalTypes.set(name, native.coreAuthority.context.resolveType(0x02000001 + index).value);
}
const core = { coreTypes: native.coreAuthority, externalTypes };

export const objectCase = name => objectCases.find(fixture => fixture.name === name);

export function prepareObject(fixture) {
  const input = objectFixture(fixture);
  const options = { coreTypes: objectAuthority(core, input),
    objectTypeAnnotations: fixture.annotationAuthority ? objectAnnotations(input) : undefined };
  return { input, inspector: new AssemblyInspector(input.bytes), options };
}

export function verifyObject(fixture, options = {}) {
  const prepared = prepareObject(fixture);
  const effective = Object.defineProperties({ ...prepared.options }, Object.getOwnPropertyDescriptors(options));
  return verifyCilMethodTypes(prepared.inspector, prepared.input.method, effective);
}
