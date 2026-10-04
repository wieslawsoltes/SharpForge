import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateExceptionInstructionPlacement, exceptionPlacementDiagnosticCatalog, CilWriter, readPE } from '@sharpforge/cil';
import { exceptionFixture } from './support/exception-encoding.js';

const check = (code, handlers = [], options) => validateExceptionInstructionPlacement(code, handlers, options);
const caught = (start, end, target, handlerEnd) => ({ start, end, target, handlerEnd, catchType: 0x01000001 });
const errorAt = (code, offset) => error => error.code === code && error.offset === offset;

test('source placement errors carry their exact instruction offset', () => {
  assert.throws(() => check(new CilWriter().op('nop').op('rethrow').finish()), errorAt('CILCF0001', 1));
  assert.throws(() => check(Uint8Array.of(0x2a, 0), [caught(0, 1, 1, 2)]), errorAt('CILCF0002', 0));
  const jump = new CilWriter().op('jmp', 0x06000001).op('nop').finish();
  assert.throws(() => check(jump, [caught(0, 5, 5, 6)]), errorAt('CILCF0003', 0));
  assert.throws(() => check(Uint8Array.of(0, 0xdc)), errorAt('CILCF0004', 1));
  assert.throws(() => check(new CilWriter().op('endfilter').finish()), errorAt('CILCF0005', 0));
  const tail = new CilWriter().op('tail.').op('call', 0x06000001).op('nop').finish();
  assert.throws(() => check(tail, [caught(0, 7, 7, 8)]), errorAt('CILCF0006', 0));
});

test('filter termination is lexical, including unreachable final instructions', () => {
  const handler = { flags: 1, start: 0, end: 1, filterOffset: 1, target: 4, handlerEnd: 5 };
  const valid = new CilWriter().op('nop').op('nop').op('endfilter').op('nop').finish();
  assert.doesNotThrow(() => check(valid, [handler]));
  const early = new CilWriter().op('nop').op('endfilter').op('nop').op('nop').finish();
  assert.throws(() => check(early, [handler]), errorAt('CILCF0005', 1));
  const missing = Uint8Array.of(0, 0x7a, 0, 0, 0);
  assert.throws(() => check(missing, [handler]), errorAt('CILCF0007', 3));
});

test('endfinally needs the innermost region, while rethrow can use any enclosing catch', () => {
  const code = new CilWriter().op('nop').op('nop').op('rethrow').op('nop').op('nop').finish();
  const inner = { flags: 2, start: 1, end: 2, target: 2, handlerEnd: 4 };
  assert.doesNotThrow(() => check(code, [inner, caught(0, 1, 1, 5)]));
  const invalid = Uint8Array.of(0, 0xdc, 0, 0, 0);
  const outer = { flags: 2, start: 0, end: 1, target: 1, handlerEnd: 5 };
  assert.throws(() => check(invalid, [caught(1, 2, 2, 3), outer]), errorAt('CILCF0004', 1));
  for (const flags of [2, 4]) {
    assert.doesNotThrow(() => check(Uint8Array.of(0, 0xdc, 0x2a), [{ flags, start: 0, end: 1, target: 1, handlerEnd: 2 }]));
  }
});

test('filter handlers permit rethrow and catch context ends at handlerEnd', () => {
  const writer = new CilWriter().op('nop').op('endfilter').op('rethrow').op('rethrow');
  const clause = { flags: 1, start: 0, end: 1, filterOffset: 1, target: 3, handlerEnd: 5 };
  assert.throws(() => check(writer.finish(), [clause]), errorAt('CILCF0001', 5));
});

test('placement leaves transfer and stack validation explicit, returns owned tree and respects limits', () => {
  assert.equal(Object.keys(exceptionPlacementDiagnosticCatalog).length, 7);
  const code = Uint8Array.of(0, 0, 0x2a);
  const tree = check(code, [caught(0, 1, 1, 2)]);
  assert(Object.isFrozen(tree));
  assert.equal(tree.regions.length, 2, 'fall-through edges are deliberately a later capability');
  assert.throws(() => check(code, [], { signal: AbortSignal.abort() }), error => error.code === 'CILR0003');
  assert.throws(() => check(code, [], { maxCodeBytes: 2 }), error => error.code === 'CILR0002');
});

test('existing native filter/fault methods and all retained Roslyn PDB fixture methods satisfy source placement', () => {
  for (const kind of ['filter', 'fault']) {
    const fixture = exceptionFixture({ kind });
    assert.doesNotThrow(() => check(fixture.code, fixture.handlers));
  }
  for (const [folder, name] of [['portable-pdb-async-writer', 'AsyncWriter'], ['portable-pdb-hoisted-locals', 'HoistedLocals'],
    ['portable-pdb-closure-map', 'ClosureMap']]) {
    const pe = readPE(readFileSync(new URL(`./fixtures/${folder}/${name}.dll`, import.meta.url)), { inspection: true });
    for (let row = 1; row <= pe.metadata.counts[6]; row++) {
      const token = 0x06000000 | row;
      if (!pe.metadata.row(token)[0]) continue;
      const body = pe.methodBody(token);
      assert.doesNotThrow(() => check(body.code, body.handlers), `${name}: ${token.toString(16)}`);
    }
  }
});
