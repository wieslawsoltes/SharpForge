import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveToolchain} from '../../../scripts/conformance/oracle/toolchain.js';
import {loadFixtures,loadFixture} from '../../../scripts/conformance/oracle/fixtures.js';
import {compileFixture} from '../../../scripts/conformance/oracle/roslyn-compile.js';
import {runFixture,executeAssembly} from '../../../scripts/conformance/oracle/clr-run.js';
import {checkFixtureContract} from '../../../scripts/conformance/oracle/qualify.js';

test('real Roslyn and CoreCLR positive, negative, cancellation and boundary fixtures', { timeout: 120000 }, async () => {
  const toolchain = await resolveToolchain({ checkImage: false });
  for (const fixture of await loadFixtures()) {
    const compiled = await compileFixture(fixture, toolchain);
    checkFixtureContract(fixture, compiled.result);
    if (fixture.execute) {
      const run = await runFixture(compiled.assembly, fixture, toolchain);
      checkFixtureContract(fixture, compiled.result, run.result);
    }
  }
});

test('actual nondeterministic CoreCLR fixture is rejected by double execution', { timeout: 30000 }, async () => {
  const toolchain = await resolveToolchain({ checkImage: false });
  const fixture = await loadFixture({ id: 'nondeterministic', source: 'Nondeterministic.cs', langVersion: '12.0' });
  const compiled = await compileFixture(fixture, toolchain);
  await assert.rejects(runFixture(compiled.assembly, fixture, toolchain), /Nondeterministic CoreCLR/);
});

test('actual CoreCLR timeout/cancellation reaps process and disposes temporary assembly', { timeout: 30000 }, async () => {
  const toolchain = await resolveToolchain({ checkImage: false });
  const fixture = await loadFixture({ id: 'waiting', source: 'Wait.cs', langVersion: '12.0' });
  const compiled = await compileFixture(fixture, toolchain);
  await assert.rejects(executeAssembly(compiled.assembly, toolchain, { timeoutMs: 100 }), /timed out/);
  const controller = new AbortController();
  const pending = executeAssembly(compiled.assembly, toolchain, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /cancelled/);
});

