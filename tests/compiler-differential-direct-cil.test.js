import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, loadPinned, loadBaseline } from '../packages/compiler/test/differential/corpus-store.js';
import { runFixture, AXES, IMAGE_AXES } from '../packages/compiler/test/differential/harness.js';

// SF-A02-T30: the direct-CIL axis of the Roslyn differential corpus. A fixture is compiled with `compileToAssembly`
// (bodies from bound trees, no bytecode image), run on the direct-CIL runtime and compared with the pinned Roslyn
// output. The whole corpus runs in packages/compiler/test/differential/run.test.js; here the rules of the axis are
// checked on a few fixtures.

const fixtures = new Map(loadFixtures().map(fixture => [fixture.id, fixture])),
  pinned = loadPinned(),
  baseline = loadBaseline(),
  run = (id, options) => runFixture(fixtures.get(id), pinned.results.get(id), options);
/** A fixture the image cannot express (virtual dispatch) that the direct pipeline runs. */
const DIRECT_ONLY = 'inheritance/abstract-class';
/** A fixture every back end runs. */
const EVERYWHERE = baseline.bytecode.find(id => baseline.directCil.includes(id));

test('A02-T30 the direct-CIL axis is one of the axes and is recorded in the baseline', () => {
  assert.deepEqual(AXES, [...IMAGE_AXES, 'directCil']);
  assert.ok(baseline.directCil.length > 250, `direct CIL passes ${baseline.directCil.length} output fixtures`);
  assert.ok(baseline.directCil.includes(DIRECT_ONLY));
  assert.ok(!baseline.bytecode.includes(DIRECT_ONLY) && !baseline.cil.includes(DIRECT_ONLY));
});

test('A02-T30 a fixture the image pipeline refuses can pass on the direct-CIL axis, and is still not `passed`', () => {
  const row = run(DIRECT_ONLY);
  assert.equal(row.unsupported, true, 'compile() reports a profile diagnostic for it');
  for (const axis of IMAGE_AXES) assert.notEqual(row[axis], true, axis);
  assert.equal(row.directCil, true);
  assert.equal(row.passed, false, '`passed` still means both image back ends');
});

test('A02-T30 the direct axis fails on its own when the direct pipeline refuses, crashes or prints something else', () => {
  const everywhere = run(EVERYWHERE);
  assert.equal(everywhere.passed, true);
  assert.equal(everywhere.directCil, true);
  const refuse = () => ({ success: false, assembly: null, diagnostics: [{ code: 'SF2200', message: 'it uses x', severity: 'error' }] }),
    notEmitted = run(EVERYWHERE, { compileToAssembly: refuse });
  assert.equal(notEmitted.directCil, false);
  assert.match(notEmitted.details.directCil, /not emitted: SF2200 it uses x/);
  assert.equal(notEmitted.passed, true, 'the image axes are not affected');
  const crashed = run(EVERYWHERE, {
    compileToAssembly() {
      throw new Error('boom');
    },
  });
  assert.equal(crashed.directCil, false);
  assert.match(crashed.details.directCil, /compiler crash: boom/);
  const pin = pinned.results.get(EVERYWHERE),
    wrongOutput = runFixture(fixtures.get(EVERYWHERE), { ...pin, output: pin.output + 'extra\n' });
  assert.equal(wrongOutput.directCil, false);
  assert.match(wrongOutput.details.directCil, /^output /);
});

test('A02-T30 diagnostics fixtures have no direct-CIL axis and a missing pin compares nothing', () => {
  const diagnosticsOnly = [...fixtures.values()].find(fixture => fixture.kind === 'diagnostics'),
    row = runFixture(diagnosticsOnly, pinned.results.get(diagnosticsOnly.id));
  assert.equal(row.directCil, null);
  assert.equal(runFixture(fixtures.get(EVERYWHERE), undefined).directCil, false);
});
