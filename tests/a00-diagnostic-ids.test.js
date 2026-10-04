import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as catalog from '../packages/compiler/src/diagnostics/codes.js';
import * as diagnostics from '../packages/compiler/src/diagnostics.js';

const {DiagnosticId: D, diagnosticCodes, diagnosticDescriptor, formatMessage} = diagnostics;
const parserIds = ['SF1003', 'SF1004', 'SF1005', 'SF1010', 'SF1011', 'SF1012',
  'SF1013', 'SF1014', 'SF1015', 'SF1017', 'SF1018', 'SF1019'];
const sourceRoot = fileURLToPath(new URL('../packages/compiler/src/', import.meta.url));
const sourceFiles = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? sourceFiles(join(directory, entry.name)) :
    entry.name.endsWith('.js') ? [join(directory, entry.name)] : []);

test('A00-T14 the diagnostic seam shares the existing catalog and every descriptor id', () => {
  assert.deepEqual(Object.keys(diagnostics), Object.keys(catalog));
  for (const [name, value] of Object.entries(catalog)) assert.equal(diagnostics[name], value, name);
  assert.deepEqual(Object.keys(D), [...diagnosticCodes(), ...parserIds]);
  for (const code of diagnosticCodes()) {
    assert.equal(D[code], code);
    const descriptor = diagnosticDescriptor(D[code]);
    assert.equal(descriptor, diagnosticDescriptor(code));
    assert.equal(descriptor.id, code);
    assert(Object.isFrozen(descriptor), code);
  }
});

test('A00-T14 identifier constants are frozen and prototype-safe', () => {
  assert(Object.isFrozen(D));
  assert.equal(Object.getPrototypeOf(D), null);
  for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'CS9999', 'SF9999']) {
    assert.equal(D[code], undefined, code);
    assert.equal(diagnosticDescriptor(code), null, code);
    assert.throws(() => formatMessage(code), RangeError, code);
  }
  assert.throws(() => { D.CS0029 = 'changed'; }, TypeError);
  assert.throws(() => { D.CS9999 = 'CS9999'; }, TypeError);
  assert.throws(() => { delete D.CS0029; }, TypeError);
});

test('A00-T14 inspected parser ids do not acquire compiler message descriptors', () => {
  for (const code of parserIds) {
    assert.equal(D[code], code);
    assert.equal(diagnosticDescriptor(D[code]), null);
    assert.throws(() => formatMessage(D[code]), RangeError);
  }
});

test('A00-T14 identifiers preserve formatting, missing arguments and profile mappings', () => {
  assert.equal(formatMessage(D.CS0029, ['string', 'int']), "Cannot implicitly convert type 'string' to 'int'");
  assert.equal(formatMessage(D.CS0029, [null]), "Cannot implicitly convert type '' to ''");
  assert.equal(formatMessage(D.SF3001, ['bad token']), 'CIL emission failed: bad token');
  assert.equal(formatMessage(D.SF2098, ['Unknown']), "Expression 'Unknown' is not implemented by this profile");
  assert.equal(diagnostics.roslynEquivalent(D.SF2005), D.CS0021);
  assert.equal(diagnostics.defaultSeverity(D.CS0168), 'warning');
  assert.equal(diagnostics.featureNotAvailableCode(7.3), D.CS8370);
  assert.equal(diagnostics.featureNotAvailableCode(-1), D.CS9058);
  assert.equal(diagnostics.isFeatureGateCode(D.CS8652), true);
  assert.equal(diagnostics.isFeatureGateCode(D.CS0029), false);
});

test('A00-T14 every compiler identifier reference resolves to the exact catalog id', () => {
  let references = 0;
  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bDiagnosticId\.((?:CS|SF)\d{4})\b/g)) {
      assert(Object.hasOwn(D, match[1]), `${file}: ${match[1]}`);
      assert.equal(D[match[1]], match[1], file);
      references++;
    }
  }
  assert(references > 100, `expected compiler caller references, saw ${references}`);
});
