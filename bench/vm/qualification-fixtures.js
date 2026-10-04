import {qualificationAssembly} from './qualification-assembly.js';
import {sourceFusionFixtures} from './source-fusion-fixtures.js';
import {microbenchmarks} from './fixtures.js';

function arithmeticLoop(width, iterations = 50000) {
  const type = width === 64 ? 'long' : 'int';
  const constant = (writer, value) => width === 64 ? writer.op('ldc.i8', BigInt(value)) : writer.integer(value);
  return qualificationAssembly({name: 'Counter' + width, locals: [type, 'int'], result: type, body(writer) {
    constant(writer, 0).op('stloc.0').integer(0).op('stloc.1').mark('loop');
    writer.op('ldloc.0');
    constant(writer, 3).op('add').op('stloc.0');
    writer.op('ldloc.1').integer(1).op('add').op('stloc.1');
    writer.op('ldloc.1').integer(iterations).op('blt', 'loop').op('ldloc.0').op('ret');
  }});
}

function slotLoop(iterations = 20000) {
  return qualificationAssembly({name: 'SlotLoop', locals: ['int', 'int', 'int'], body(writer) {
    writer.integer(42).op('stloc.0').integer(0).op('stloc.2').mark('loop');
    for (let index = 0; index < 8; index++) writer.op('ldloc.0').op('stloc.1').op('ldloc.1').op('stloc.0');
    writer.op('ldloc.2').integer(1).op('add').op('stloc.2');
    writer.op('ldloc.2').integer(iterations).op('blt', 'loop').op('ldloc.1').op('ret');
  }});
}

export const recursivePoolFixture = Object.freeze({id: 'recursive-frame-pool', expectedReturn: 8256,
  source: `class Box { public int Value; } class Program {
    static int Sum(int n) { Box item = new Box(); item.Value = n;
      if (n == 0) return item.Value; return item.Value + Sum(n - 1); }
    static int Main() { return Sum(128); }
  }`});

/** Each reference switches only the requested mechanism; assemblies are created outside observation timers. */
export function qualificationTargets() {
  const speedup = value => ({kind: 'minimum-speedup', value});
  return [
    ...sourceFusionFixtures.map(fixture => ({id: 'source-' + fixture.id, issue: 1394, engine: 'source', fixture,
      baselineOptions: {sourceFusion: false}, candidateOptions: {sourceFusion: true}, target: speedup(1.5)})),
    {id: 'virtual-cache', issue: 1391, engine: 'cil', fixture: microbenchmarks.find(fixture => fixture.id === 'virtual'),
      baselineOptions: {inlineCaches: false}, candidateOptions: {inlineCaches: true}, target: speedup(3)},
    {id: 'int32-specialization', issue: 1396, engine: 'cil', fixture: {id: 'int32-counter', expectedReturn: 150000},
      build: () => ({assembly: arithmeticLoop(32), image: null}),
      expectedHandlers: ['add_i4'],
      baselineOptions: {specializeNumericHandlers: false}, candidateOptions: {specializeNumericHandlers: true}, target: speedup(2)},
    {id: 'small-long', issue: 1397, engine: 'cil', fixture: {id: 'int64-counter', expectedReturn: 150000n},
      build: () => ({assembly: arithmeticLoop(64), image: null}),
      expectedHandlers: ['add_small_i8'],
      baselineOptions: {smallLongs: false}, candidateOptions: {smallLongs: true}, target: speedup(3)},
    {id: 'scalar-slot-loads', issue: 1398, engine: 'cil', fixture: {id: 'local-copy-loop', expectedReturn: 42},
      build: () => ({assembly: slotLoop(), image: null}), metric: 'nanosecondsPerInstruction',
      baselineOptions: {scalarSlotLoads: false}, candidateOptions: {scalarSlotLoads: true},
      target: {kind: 'minimum-reduction', value: 0.3}},
    ...['source', 'cil'].map(engine => ({id: 'frame-pool-' + engine, issue: 1399, engine, fixture: recursivePoolFixture,
      baselineOptions: {framePooling: false}, candidateOptions: {framePooling: true}, target: {kind: 'zero-warm-frame-storage'}})),
    {id: 'warm-call-plans', issue: 1390, engine: 'cil', fixture: microbenchmarks.find(fixture => fixture.id === 'calls'),
      baselineOptions: {}, candidateOptions: {}, target: {kind: 'zero-warm-offset-maps'},
      note: 'Both observations use current decode plans; the acceptance target is zero new offset maps during warm calls.'},
    {id: 'warm-fields', issue: 1392, engine: 'cil', fixture: microbenchmarks.find(fixture => fixture.id === 'fields'),
      baselineOptions: {}, candidateOptions: {}, countTokens: true, target: {kind: 'zero-warm-token-resolution'},
      note: 'Both observations use the field cache; the acceptance target is the measured warm resolveToken count, not a speedup.'}
  ];
}

/** A focused repeat keeps the same definition and threshold as the complete suite. */
export function selectQualificationTargets(target = null) {
  const definitions = qualificationTargets();
  if (target === null) return definitions;
  const selected = definitions.filter(definition => definition.id === target);
  if (!selected.length) throw new RangeError('Unknown qualification target: ' + target);
  return selected;
}
