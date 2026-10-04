import test from 'node:test';
import assert from 'node:assert/strict';
import {CilDebugSession} from '@sharpforge/debugger';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture() {
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Leaf', parameters: ['int'], locals: ['int'], result: 'int', body(writer) {
      writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret');
    }},
    {name: 'Caller', parameters: ['int'], locals: ['int', 'int'], result: 'int', body(writer, context) {
      writer.op('ldc.i4.4').op('stloc.1').op('ldc.i4', 100).op('call', context.methods.get('Program.Leaf')).op('pop');
      writer.op('ldarg.0').op('ldloc.1').op('add').op('ret');
    }},
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4.3').op('call', context.methods.get('Program.Caller')).op('ret');
    }}
  ]}]);
}

test('debugger edits the selected caller arguments and locals through owned storage', () => {
  const session = new CilDebugSession(fixture(), {recordHistory: true});
  try {
    assert.equal(session.setFunctionBreakpoints(['Program.Leaf'])[0].verified, true);
    session.start(false);
    assert.equal(session.runUntilStop().state, 'paused');
    const top = session.vm.top;
    const caller = session.stackTrace().find(frame => frame.name === 'Program::Caller');
    assert(caller);
    assert.notEqual(caller.id, top.id);
    assert.equal(session.evaluate('arg0', caller.id).value, 3);
    assert.equal(session.evaluate('V_1', caller.id).value, 4);

    const info = session.dataBreakpointInfo({frameId: caller.id, name: 'V_1'});
    assert.equal(session.setDataBreakpoints([{dataId: info.dataId}])[0].verified, true);
    assert.equal(session.setVariable(caller.id, 'arg0', '20').raw, 20);
    assert.equal(session.setVariable(caller.id, 'V_1', '7').raw, 7);
    assert.equal(session.reason.reason, 'data breakpoint');
    assert.equal(session.reason.write.frameId, caller.id);
    assert.equal(session.reason.write.index, 1);
    assert.equal(session.evaluate('arg0', caller.id).value, 20);
    assert.equal(session.evaluate('V_1', caller.id).value, 7);
    assert.equal(session.vm.top, top, 'editing a caller must not switch execution frames');
    assert.equal(session.evaluate('arg0').value, 100);
    assert.equal(session.evaluate('V_0').value, 0);

    session.resume();
    const result = session.runUntilStop();
    assert.equal(result.state, 'terminated');
    assert.equal(result.returnValue, '27');
  } finally {
    session.stop();
  }
});
