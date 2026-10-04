import test from 'node:test';
import assert from 'node:assert/strict';
import { splitNativeException, isClrExceptionTermination } from '../../../scripts/conformance/diff/engines/native-exception.js';
import { classify, normalise } from '../../../scripts/conformance/diff/classify.js';
import { result } from '../../../scripts/conformance/diff/result.js';

const fixture = { inputHash: 'f'.repeat(64), normalisers: ['newlines', 'exception-text'] };
const diagnostic = 'Unhandled exception. System.InvalidOperationException: Failure.\r\n   at Program.Main()\r\n';
const raw = (prefix = '') => ({ stderr: prefix + diagnostic, stdout: '', exitCode: null, signal: 'SIGABRT',
  stdoutBase64: '', stderrBase64: Buffer.from(prefix + diagnostic).toString('base64') });
function native(engine, prefix) {
  const process = raw(prefix);
  return result(engine, { ...process, ...splitNativeException(process, 'linux'), status: 'runtime-error', exitCode: null,
    exitCodeKind: 'process', artifactHash: 'a'.repeat(64) });
}

test('native diagnostic splitting preserves exact stderr prefixes and raw transport bytes', () => {
  for (const prefix of ['application error\r\n', 'no-newline → ', '', 'Unhandled exception. is ordinary prose\n']) {
    const process = raw(prefix), before = structuredClone(process);
    const split = splitNativeException(process, 'linux');
    assert.deepEqual(split.exception, { type: 'System.InvalidOperationException', message: 'Failure.' });
    assert.equal(split.exceptionDiagnostic, diagnostic);
    assert.deepEqual(process, before);
    const record = native('clr-sharpforge', prefix);
    assert.equal(record.stderr, prefix + diagnostic); assert.equal(record.stderrBase64, before.stderrBase64);
    assert.equal(normalise(record, fixture).stderr, prefix.replace(/\r\n?/g, '\n'));
  }
});

test('successful lookalikes, ordinary nonzero exits and unrelated signals remain application stderr', () => {
  for (const process of [
    { ...raw(), exitCode: 0, signal: null }, { ...raw(), exitCode: 1, signal: null },
    { ...raw(), exitCode: null, signal: 'SIGTERM' }, { ...raw(), exitCode: null, signal: 'SIGSEGV' },
  ]) for (const platform of ['linux', 'darwin', 'win32']) {
    assert.equal(splitNativeException(process, platform).exception, null);
    const record = result('clr-roslyn', { ...process, exitCodeKind: 'process' });
    assert.equal(normalise(record, fixture).stderr, process.stderr.replace(/\r\n?/g, '\n'));
  }
});

test('signed and unsigned Windows CLR exception status supports diagnostics without inventing signal evidence', () => {
  for (const code of [0xe0434352, 0xe0434352 | 0]) {
    const process = { ...raw('before\n'), signal: null, exitCode: code };
    assert.equal(isClrExceptionTermination(process, 'win32'), true);
    assert.equal(splitNativeException(process, 'win32').exceptionDiagnostic, diagnostic);
  }
  for (const code of [0, 1, 0x1e0434352, -0x100000001, 0xc000027b]) {
    assert.equal(splitNativeException({ ...raw(), signal: null, exitCode: code }, 'win32').exception, null);
  }
});

test('ambiguous, incomplete or interleaved diagnostics are retained rather than stripped', () => {
  for (const stderr of [
    'Unhandled exception. System.Exception: user lookalike\n' + diagnostic,
    'Unhandled exception. System.Exception: missing stack\n',
    diagnostic + 'application output after stack\n',
    diagnostic + 'Unhandled exception. System.Exception: another header\n',
  ]) {
    const process = { ...raw(), stderr };
    assert.deepEqual(splitNativeException(process, 'linux'), { exception: null, exceptionDiagnostic: null });
    assert.equal(normalise(result('clr-sharpforge', { ...process, exitCodeKind: 'process' }), fixture).stderr, stderr.replace(/\r\n?/g, '\n'));
  }
});

test('managed exceptions preserve stderr differences and same-engine repeat drift', () => {
  const rows = ['source-vm', 'cil-vm', 'clr-sharpforge', 'clr-roslyn'].map(engine => native(engine, 'shared\n'));
  for (const record of rows.slice(0, 2)) { record.stderr = 'shared\n'; delete record.exceptionDiagnostic; }
  assert.deepEqual(classify(fixture, [rows, structuredClone(rows)]).differences, []);
  const changed = structuredClone(rows); Object.assign(changed[3], native('clr-roslyn', 'different\n'));
  assert(classify(fixture, [changed, structuredClone(changed)]).differences.some(difference => difference.class === 'compiler'));
  const second = structuredClone(rows); Object.assign(second[3], native('clr-roslyn', 'later\n'));
  assert(classify(fixture, [rows, second]).differences.some(difference => difference.class === 'fixture-nondeterminism'));
});

test('only explicit native diagnostic suffixes may be removed during normalization', () => {
  const exception = { type: 'System.Exception', message: 'Failure' };
  for (const engine of ['source-vm', 'cil-vm', 'clr-sharpforge', 'clr-roslyn']) {
    assert.equal(normalise(result(engine, { exception, stderr: 'application error' }), fixture).stderr, 'application error');
  }
  for (const record of [
    result('clr-sharpforge', { exception, stderr: diagnostic, exceptionDiagnostic: '' }),
    result('clr-sharpforge', { exception, stderr: diagnostic, exceptionDiagnostic: 'wrong suffix' }),
    result('clr-sharpforge', { exception, stderr: diagnostic, exceptionDiagnostic: {} }),
    result('source-vm', { exception, stderr: diagnostic, exceptionDiagnostic: diagnostic }),
    result('clr-sharpforge', { stderr: diagnostic, exceptionDiagnostic: diagnostic }),
  ]) assert.throws(() => normalise(record, fixture), /Malformed native exception diagnostic/);
});


test('multiline native exception messages remain observable when stack diagnostics are separated', () => {
  const stderr='prefix\nUnhandled exception. System.Exception: first\r\nsecond\nthird\r\n   at Program.Main()\r\n';
  const split=splitNativeException({...raw(),stderr},'linux');
  assert.deepEqual(split.exception,{type:'System.Exception',message:'first\r\nsecond\nthird'});
  const record=result('clr-roslyn',{stderr,...split,status:'runtime-error',exitCode:null});
  assert.equal(normalise(record,fixture).stderr,'prefix\n');
  assert.equal(normalise(record,fixture).exception.message,'first\nsecond\nthird');
});


test('native inner-exception diagnostics do not become the outer exception message', () => {
  for(const separator of ['\n ---> ',' ---> ']){
    const stderr='application\nUnhandled exception. System.Exception: outer\r\nsecond'+separator+'System.Exception: inner\n   at Program.Inner()\n   --- End of inner exception stack trace ---\n   at Program.Main()\n';
    const split=splitNativeException({...raw(),stderr},'linux');
    assert.deepEqual(split.exception,{type:'System.Exception',message:'outer\r\nsecond'});
    assert.equal(normalise(result('clr-roslyn',{stderr,...split,status:'runtime-error',exitCode:null}),fixture).stderr,'application\n');
  }
  const ordinary='Unhandled exception. System.Exception: outer\n ---> ordinary message text\n   at Program.Main()\n';
  assert.equal(splitNativeException({...raw(),stderr:ordinary},'linux').exception.message,'outer\n ---> ordinary message text');
});
