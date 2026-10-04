import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilDebugSession} from '@sharpforge/debugger';
import {verifiedMethod} from '../packages/runtime/src/execution/token-cache.js';

const source = `class Box {
 public int Value;
 public Box(int value) { Value=value; }
}
class P {
 public static Box Make(int value) { return new Box(value); }
 static void Main() {
 int x=1;
 Console.WriteLine(x);
 }
}`;
const consent = {allowSideEffects: true, timeBudgetMs: 2000};

function pausedSession() {
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const session = new CilDebugSession(compiled.assembly, {recordHistory: true});
  session.setBreakpoints('Program.cs', [{line: 9}]);
  session.start(false);
  session.runUntilStop();
  assert.equal(session.vm.state, 'paused');
  return session;
}

test('late debugger verification publishes a new membership set and rollback revokes the added methods', () => {
  const session = pausedSession();
  const {vm} = session;
  const constructor = [...vm.inspector.methods.values()].find(method => method.owner === 'Box' && method.name === '.ctor');
  const original = [...vm.report.methods];
  try {
    assert.equal(verifiedMethod(vm, constructor.token), false, 'Warm the pre-evaluation membership cache');
    const preview = session.evaluateFunction('P.Make(7).Value', {...consent, commit: false});
    assert.equal(preview.value, 7);
    assert.deepEqual(vm.report.methods, original);
    assert.equal(verifiedMethod(vm, constructor.token), false, 'Rollback must revoke temporary roots');
    const methodsBeforeCommit = vm.report.methods;
    const committed = session.evaluateFunction('P.Make(9)', consent);
    assert.equal(vm.heap.get(committed.reference).data[0], 9);
    assert.notEqual(vm.report.methods, methodsBeforeCommit);
    assert.equal(verifiedMethod(vm, constructor.token), true);
    assert.equal(vm.state, 'paused');
  } finally { session.stop(); }
});

test('failed late verification never publishes an executable method membership', () => {
  const session = pausedSession();
  const {vm} = session;
  const method = [...vm.inspector.methods.values()].find(value => value.owner === 'P' && value.name === 'Make');
  const body = vm.inspector.getMethod(method.token);
  const original = [...vm.report.methods];
  try {
    assert.equal(verifiedMethod(vm, method.token), false);
    body.instructions[0] = {...body.instructions[0], name: 'pop', operand: null, operandKind: 'InlineNone'};
    assert.throws(() => session.evaluateFunction('P.Make(7)', consent));
    assert.deepEqual(vm.report.methods, original);
    assert.equal(verifiedMethod(vm, method.token), false);
    assert.equal(vm.state, 'paused');
  } finally { session.stop(); }
});
