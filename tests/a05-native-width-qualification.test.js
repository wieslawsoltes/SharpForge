import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {numericDifferential} from './support/numeric-differential.js';
import {verifyNativeWidthReport} from '../scripts/a05/native-width-proof.js';

const fixture = new URL('./fixtures/a05/native-width/', import.meta.url);
const source = readFileSync(new URL('Program.cs', fixture), 'utf8');

for (const bits of [32, 64]) {
  test(`native-width fixture preserves its authored ${bits}-bit expectations across compiler routes`, () => {
    const file = bits === 32 ? 'expected-32.txt' : 'expected.txt';
    numericDifferential(source, readFileSync(new URL(file, fixture), 'utf8'), {nativeIntBits: bits});
  });
}

function syntheticReport() {
  const hash = '0'.repeat(64);
  const output = '4\n4\n';
  return {status: 'passed', passed: true, fixture: 'native-width', dotnetSdk: '10.0.201', assemblySha256: hash,
    native: {exitCode: 0, signal: null, output}, cil: {state: 'terminated', exitCode: 0, output},
    nativeRuntime: {nativeIntBits: 32, processArchitecture: 'X86', exitCode: 0, signal: null,
      probe: {sourceSha256: hash, assemblySha256: hash}, runtimeConfig: {sha256: hash}},
    sourceRoutes: {nativeIntBits: 32, routes: ['source', 'reloaded-source', 'compiled-cil'].map(engine =>
      ({engine, state: 'terminated', exitCode: 0, output}))}};
}

test('width proof requires observed CLR process identity and every matching route', () => {
  assert.equal(verifyNativeWidthReport(syntheticReport(), {bits: 32, sdk: '10.0.201'}).bits, 32);
  for (const change of [
    report => { report.nativeRuntime.nativeIntBits = 64; },
    report => { report.nativeRuntime.processArchitecture = 'X64'; },
    report => { report.dotnetSdk = '8.0.425'; },
    report => { report.native.output = '8\n8\n'; },
    report => { report.sourceRoutes.nativeIntBits = 64; },
    report => { report.sourceRoutes.routes[1].output = 'different'; },
    report => { report.nativeRuntime.signal = 'SIGABRT'; },
    report => { report.status = 'unsupported'; }
  ]) {
    const report = syntheticReport();
    change(report);
    assert.throws(() => verifyNativeWidthReport(report, {bits: 32, sdk: '10.0.201'}));
  }
});
