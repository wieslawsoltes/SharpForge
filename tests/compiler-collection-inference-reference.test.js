import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { fixtureHash, loadPinned } from '../packages/compiler/test/differential/corpus-store.js';
import { fixtures } from '../packages/compiler/test/differential/fixtures/collection-inference.js';
import {
  dotnetHost,
  sdkVersion,
  openDotnetScratch,
  runFixtureOnDotnet,
} from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const pins = loadPinned();

test('collection inference reference fixtures have current real Roslyn pins', () => {
  for (const fixture of fixtures) {
    const pin = pins.results.get(fixture.id);
    assert.equal(pin?.hash, fixtureHash(fixture), fixture.id);
    assert.equal(pin.kind, fixture.kind, fixture.id);
  }
});

const pack = loadReferencePack();
const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
const noReferences = pack ? false : 'no .NET reference pack is installed';
const noRuntime = noReferences || (sdk ? false : 'no .NET SDK host is installed');
const sortDiagnostics = diagnostics => diagnostics.sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));

test('collection inference diagnostics match Roslyn with real reference assemblies', { skip: noReferences }, () => {
  for (const fixture of fixtures) {
    const langVersion = fixture.langVersion ?? '14';
    const file = parse(new SourceText(fixture.source, 'Program.cs'), undefined, { languageVersion: langVersion });
    const result = analyze([file], { langVersion, references: pack.references });
    const actual = result.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => [diagnostic.code, diagnostic.start, diagnostic.length, diagnostic.severity]);
    const expected = pins.results.get(fixture.id).diagnostics.filter(diagnostic => diagnostic[3] === 'error');
    assert.deepEqual(sortDiagnostics(actual), sortDiagnostics(expected), fixture.id);
  }
});

test('collection inference assemblies execute with the pinned output on real .NET', { skip: noRuntime }, context => {
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  let count = 0;
  try {
    for (const fixture of fixtures) {
      if (fixture.kind !== 'output') continue;
      const result = runFixtureOnDotnet(fixture, pins.results.get(fixture.id), scratch.context('references'));
      assert.equal(result.ok, true, `${fixture.id}: ${result.detail}`);
      count++;
    }
  } finally {
    scratch.close();
  }
  context.diagnostic(`${count} assemblies ran on .NET ${sdk}, reference pack ${pack.pack.version}`);
});
