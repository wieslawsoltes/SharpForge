import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { loadFixtures } from '../packages/compiler/test/differential/corpus-store.js';
import { loadDotnetBaseline, fixtureOptions, COLUMNS } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

// SF-A02-T30: the real-.NET columns of the differential corpus. `tools/dotnet-axis.mjs` runs every emitted assembly
// on .NET and records the fixtures that print the pinned Roslyn output in dotnet-baseline.json (SDK 10.0.201,
// reference pack 10.0.5). Running .NET is not possible in a unit test; this file checks what is: the baseline is
// well formed, and every fixture recorded for the `references` column still emits an assembly when it is compiled
// against the installed reference pack (skipped where no .NET SDK is installed).

const baseline = loadDotnetBaseline(),
  fixtures = new Map(loadFixtures().map(fixture => [fixture.id, fixture]));

test('A02-T30 the real-.NET baseline names output fixtures, sorted and without duplicates', () => {
  assert.match(String(baseline.sdk), /^\d+\.\d+\.\d+/);
  for (const column of COLUMNS) {
    const ids = baseline[column];
    assert.ok(ids.length > 400, `${column}: ${ids.length} fixtures`);
    assert.deepEqual(ids, [...new Set(ids)].sort(), `${column} is sorted and unique`);
    for (const id of ids) assert.equal(fixtures.get(id)?.kind, 'output', `${column}: ${id} is an output fixture`);
  }
});

test('A02-T30 binding against real references does not lose a fixture the registry build runs on .NET', () => {
  // The fixtures below still need work in the binder or the emitter when they are bound against real metadata; the
  // list only shrinks.
  const references = new Set(baseline.references),
    missing = baseline.registry.filter(id => !references.has(id));
  assert.deepEqual(missing, [
    'arithmetic/checked-overflow',
    'arithmetic/int-overflow-wraps',
    'deconstruction/foreach-deconstructs-each-element',
    'extension-blocks/generic-blocks',
    'foreach-patterns/extension-get-enumerator',
    'foreach/custom-enumerable',
    'generic-interactions/tuples-and-iterators-over-constructions',
    'generic-lowering/iterators-async-and-local-functions',
    'iterator-disposal/iterators-over-iterators-dispose-inner',
    'iterator-disposal/jumps-out-of-a-protected-region',
    'iterator-disposal/nested-finally-and-early-break',
    'iterator-disposal/using-inside-iterator',
    'iterator-disposal/yield-break-and-exception-run-finally',
    'iterators/iterators-with-closures-and-local-functions',
    'iterators/laziness-and-re-enumeration',
    'iterators/yield-in-loops-and-branches',
    'string-elements/foreach-over-a-string',
  ]);
});

const pack = loadReferencePack();

test('A02-T30 every fixture recorded for the references column emits against the reference pack', { skip: pack ? false : 'no .NET reference pack is installed' }, () => {
  const failures = [];
  for (const id of baseline.references) {
    const fixture = fixtures.get(id),
      result = compileToAssembly(fixture.source, { ...fixtureOptions(fixture), references: pack.references });
    if (result.assembly) continue;
    const errors = result.diagnostics.filter(entry => entry.severity === 'error');
    failures.push(`${id}: ${errors.map(entry => `${entry.code} ${entry.message}`).join('; ')}`);
  }
  assert.deepEqual(failures, []);
});
