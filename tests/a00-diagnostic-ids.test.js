import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as catalog from '../packages/compiler/src/diagnostics/codes.js';
import * as diagnostics from '../packages/compiler/src/diagnostics.js';
import {codeTokens} from '../scripts/conformance/static/code-tokens.js';

const {DiagnosticId, diagnosticCodes, diagnosticDescriptor, formatMessage} = diagnostics;
const parserIds = ['SF1003', 'SF1004', 'SF1005', 'SF1010', 'SF1011', 'SF1012',
  'SF1013', 'SF1014', 'SF1015', 'SF1017', 'SF1018', 'SF1019'];
const sourceRoot = fileURLToPath(new URL('../packages/compiler/src/', import.meta.url));
const sourceFiles = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? sourceFiles(join(directory, entry.name)) :
    entry.name.endsWith('.js') ? [join(directory, entry.name)] : []);
const diagnosticLiterals = source => codeTokens(source).filter((token, index, tokens) =>
  token.value === '<string>' && /^(['"])(?:CS|SF)\d{4}\1$/.test(source.slice(token.start, token.end)) ||
  token.value === '<template>' && /^`(?:CS|SF)\d{4}`/.test(source.slice(token.start)) ||
  /^(?:CS|SF)\d{4}$/.test(token.value) && ['{', ','].includes(tokens[index - 1]?.value) && tokens[index + 1]?.value === ':');

test('A00-T14 literal scanning inspects code without interpreting documentation or regular expressions', () => {
  assert.equal(diagnosticLiterals("report('CS0122'); report(\"SF2200\"); report(`CS1540`); const ids = {CS0029: 1};").length, 4);
  assert.equal(diagnosticLiterals("// report('CS0122')\n/* {code:'CS1540'} */\nconst pattern = /'SF2200'/; report(ok ? DiagnosticId.CS0122 : DiagnosticId.CS1540);").length, 0);
  assert.equal(diagnosticLiterals("const text = `diagnostic 'CS0122'`; const value = `${report('SF2200')}`;").length, 1);
});

test('A00-T14 the diagnostic seam shares the existing catalog and every descriptor id', () => {
  assert.deepEqual(Object.keys(diagnostics), Object.keys(catalog));
  for (const [name, value] of Object.entries(catalog)) assert.equal(diagnostics[name], value, name);
  assert.deepEqual(Object.keys(DiagnosticId), [...diagnosticCodes(), ...parserIds]);
  for (const code of diagnosticCodes()) {
    assert.equal(DiagnosticId[code], code);
    const descriptor = diagnosticDescriptor(DiagnosticId[code]);
    assert.equal(descriptor, diagnosticDescriptor(code));
    assert.equal(descriptor.id, code);
    assert(Object.isFrozen(descriptor), code);
  }
});

test('A00-T14 identifier constants are frozen and prototype-safe', () => {
  assert(Object.isFrozen(DiagnosticId));
  assert.equal(Object.getPrototypeOf(DiagnosticId), null);
  for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'CS9999', 'SF9999']) {
    assert.equal(DiagnosticId[code], undefined, code);
    assert.equal(diagnosticDescriptor(code), null, code);
    assert.throws(() => formatMessage(code), RangeError, code);
  }
  assert.throws(() => { DiagnosticId.CS0029 = 'changed'; }, TypeError);
  assert.throws(() => { DiagnosticId.CS9999 = 'CS9999'; }, TypeError);
  assert.throws(() => { delete DiagnosticId.CS0029; }, TypeError);
});

test('A00-T14 inspected parser ids do not acquire compiler message descriptors', () => {
  for (const code of parserIds) {
    assert.equal(DiagnosticId[code], code);
    assert.equal(diagnosticDescriptor(DiagnosticId[code]), null);
    assert.throws(() => formatMessage(DiagnosticId[code]), RangeError);
  }
});

test('A00-T14 identifiers preserve formatting, missing arguments and profile mappings', () => {
  assert.equal(formatMessage(DiagnosticId.CS0029, ['string', 'int']), "Cannot implicitly convert type 'string' to 'int'");
  assert.equal(formatMessage(DiagnosticId.CS0029, [null]), "Cannot implicitly convert type '' to ''");
  assert.equal(formatMessage(DiagnosticId.SF3001, ['bad token']), 'CIL emission failed: bad token');
  assert.equal(formatMessage(DiagnosticId.SF2098, ['Unknown']), "Expression 'Unknown' is not implemented by this profile");
  assert.equal(diagnostics.roslynEquivalent(DiagnosticId.SF2005), DiagnosticId.CS0021);
  assert.equal(diagnostics.defaultSeverity(DiagnosticId.CS0168), 'warning');
  assert.equal(diagnostics.featureNotAvailableCode(7.3), DiagnosticId.CS8370);
  assert.equal(diagnostics.featureNotAvailableCode(-1), DiagnosticId.CS9058);
  assert.equal(diagnostics.isFeatureGateCode(DiagnosticId.CS8652), true);
  assert.equal(diagnostics.isFeatureGateCode(DiagnosticId.CS0029), false);
});

test('A00-T14 every compiler identifier reference resolves to the exact catalog id', () => {
  let references = 0;
  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bDiagnosticId\.((?:CS|SF)\d{4})\b/g)) {
      assert(Object.hasOwn(DiagnosticId, match[1]), `${file}: ${match[1]}`);
      assert.equal(DiagnosticId[match[1]], match[1], file);
      references++;
    }
  }
  assert(references > 100, `expected compiler caller references, saw ${references}`);
});

test('A00-T14 compiler diagnostic id literals are confined to the existing catalog', () => {
  const catalogs = new Set(['codes.js', 'roslyn-codes.js'].map(name => join(sourceRoot, 'diagnostics', name)));
  let callers = 0;
  for (const file of sourceFiles(sourceRoot)) {
    if (catalogs.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    assert.deepEqual(diagnosticLiterals(source).map(token => source.slice(token.start, token.end)), [], file);
    if (/\bDiagnosticId\./.test(source)) callers++;
  }
  assert(callers > 100, `expected coverage across compiler layers, saw ${callers}`);
});
