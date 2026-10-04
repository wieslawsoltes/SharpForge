import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { loadFixtures, loadPinned, fixtureHash } from '../packages/compiler/test/differential/corpus-store.js';
import {
  loadDotnetBaseline,
  dotnetHost,
  sdkVersion,
  openDotnetScratch,
  runFixtureOnDotnet,
} from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

// SF-A02-T30: the stress family of the differential corpus - realistic programs that combine features, written after
// the feature fixtures (fixtures/stress/<feature>/<name>.cs, pinned from Roslyn 5.3.0 by tools/pin.mjs). Their axis is
// real .NET: the assembly `compileToAssembly` emits against the reference pack runs on the installed runtime and must
// print the pinned output. The programs that do so are recorded in dotnet-baseline.json; this file runs exactly those
// (the others are known failures the baseline does not list), and is skipped where no .NET SDK is installed.

const STRESS = /^stress-[a-z]+\//,
  fixtures = loadFixtures().filter(fixture => STRESS.test(fixture.id)),
  pinned = loadPinned(),
  baseline = loadDotnetBaseline();

test('A02-T30 stress family: at least 60 pinned output programs of 60 to 220 lines', () => {
  assert.ok(fixtures.length >= 60, `${fixtures.length} stress programs`);
  for (const fixture of fixtures) {
    const pin = pinned.results.get(fixture.id),
      lines = fixture.source.split('\n').length;
    assert.equal(fixture.kind, 'output', fixture.id);
    assert.ok(lines >= 60 && lines <= 220, `${fixture.id}: ${lines} lines`);
    assert.ok(!fixture.source.includes('\r'), `${fixture.id}: line ends are normalised`);
    assert.equal(pin?.hash, fixtureHash(fixture), `${fixture.id}: pinned from Roslyn (tools/pin.mjs)`);
    assert.deepEqual(pin.diagnostics.filter(entry => entry[3] === 'error'), [], fixture.id);
    assert.ok(pin.output.length > 0, `${fixture.id}: prints something`);
  }
});

test('A02-T30 stress family: a recorded program is a stress fixture of the references column', () => {
  const known = new Set(fixtures.map(fixture => fixture.id)),
    recorded = baseline.references.filter(id => STRESS.test(id));
  for (const id of recorded) assert.ok(known.has(id), `${id} names a stress fixture`);
  assert.ok(recorded.length > 0, 'some stress programs run on .NET');
});

const pack = loadReferencePack(),
  dotnet = dotnetHost(),
  sdk = pack ? sdkVersion(dotnet) : null,
  skip = !pack ? 'no .NET reference pack is installed' : !sdk ? `no .NET host ('${dotnet}') to run the assemblies on` : false;

test('A02-T30 stress family: every recorded program prints the pinned Roslyn output on real .NET', { skip }, t => {
  const recorded = new Set(baseline.references),
    scratch = openDotnetScratch({ dotnet, sdk, pack }),
    failures = [];
  let ran = 0;
  try {
    const context = scratch.context('references');
    for (const fixture of fixtures) {
      if (!recorded.has(fixture.id)) continue;
      const row = runFixtureOnDotnet(fixture, pinned.results.get(fixture.id), context);
      ran++;
      if (!row.ok) failures.push(`${fixture.id}: ${row.detail}`);
    }
  } finally {
    scratch.close();
  }
  t.diagnostic(`${ran} of ${fixtures.length} stress programs ran on .NET ${sdk} (reference pack ${pack.pack.version})`);
  assert.deepEqual(failures, []);
});
