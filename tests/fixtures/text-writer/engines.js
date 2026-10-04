import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';

export const writerType = 'System.IO.StringWriter';
export const parentType = 'System.IO.TextWriter';
export const builderType = 'System.Text.StringBuilder';
let emptyProgram;

export function writerContract(name, parameters = []) {
  const descriptor = findContracts(writerType, name, false)
    .find(item => JSON.stringify(item.parameters) === JSON.stringify(parameters));
  assert(descriptor, 'Missing writer contract: ' + name + '(' + parameters + ')');
  return descriptor;
}

/** Real platform dispatch with a strong writer root released by stop(). */
export function writerPlatform(engine) {
  emptyProgram ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(emptyProgram.success, true, JSON.stringify(emptyProgram.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(emptyProgram.image) : new CilVirtualMachine(emptyProgram.assembly);
  const platform = vm.platform;
  const reference = platform.invoke(writerContract('.ctor'), []);
  const root = platform.heap.createHandle(reference);
  const call = (name, parameters = [], args = []) => platform.invoke(writerContract(name, parameters), [reference, ...args]);
  return {vm, platform, reference, call, stop() { platform.heap.releaseHandle(root); vm.stop(); }};
}

/** Independent CIL character/base calls avoid the source compiler's deliberate Char restriction. */
export function writerBaseAssembly() {
  return managedFixture({methods: [{name: 'Main', result: 'void', locals: [parentType], body(writer, context) {
    writer.op('newobj', context.member(writerType, '.ctor', 'void', [], false));
    writer.op('castclass', context.resolve(parentType)).op('stloc.0');
    for (const unit of [0, 0xd800, 0xdc00, 0xffff]) {
      writer.op('ldloc.0').op('ldc.i4', unit).op('conv.u2');
      writer.op('callvirt', context.member(parentType, 'Write', 'void', ['char'], false));
    }
    for (let index = 0; index < 4; index++) {
      writer.op('ldloc.0').op('castclass', context.resolve(writerType));
      writer.op('callvirt', context.member(writerType, 'ToString', 'string', [], false));
      writer.op('ldc.i4', index).op('callvirt', context.member('System.String', 'get_Chars', 'char', ['int'], false));
      writer.op('conv.i4').op('call', context.member('System.Console', 'WriteLine', 'void', ['int']));
    }
    writer.op('ldloc.0').op('isinst', context.resolve('System.IDisposable')).op('ldnull').op('cgt.un');
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['bool']));
    writer.op('ldloc.0').op('ldstr', 0x70000000 + context.md.userString('|'));
    writer.op('callvirt', context.member(parentType, 'set_NewLine', 'void', ['string'], false));
    writer.op('ldloc.0').op('ldstr', 0x70000000 + context.md.userString('base'));
    writer.op('callvirt', context.member(parentType, 'WriteLine', 'void', ['string'], false));
    writer.op('ldloc.0').op('castclass', context.resolve(writerType));
    writer.op('callvirt', context.member(writerType, 'ToString', 'string', [], false));
    writer.op('ldstr', 0x70000000 + context.md.userString('base|'));
    writer.op('callvirt', context.member('System.String', 'EndsWith', 'bool', ['string'], false));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['bool'])).op('ret');
  }}]});
}

export function writerFaultAssembly({name = 'Write', parameters = ['string'], nullValue = false,
  nullBuilder = false, nullReceiver = false} = {}) {
  return managedFixture({methods: [{name: 'Main', result: 'void', body(writer, context) {
    if (nullBuilder) {
      writer.op('ldnull').op('newobj', context.member(writerType, '.ctor', 'void', [builderType], false)).op('pop').op('ret');
      return;
    }
    if (nullReceiver) {
      writer.op('ldnull').op('callvirt', context.member(writerType, 'ToString', 'string', [], false)).op('pop').op('ret');
      return;
    }
    writer.op('newobj', context.member(writerType, '.ctor', 'void', [], false));
    writer.op('dup').op('callvirt', context.member(parentType, 'Dispose', 'void', [], false));
    if (parameters[0] === 'char') writer.op('ldc.i4', 120).op('conv.u2');
    else if (parameters.length) {
      if (nullValue) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString('x'));
    }
    writer.op('callvirt', context.member(parentType, name, 'void', parameters, false)).op('ret');
  }}]});
}
