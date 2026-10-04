import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';

export const readerType = 'System.IO.StringReader';
export const parentType = 'System.IO.TextReader';
let emptyProgram;

export function readerContract(name) {
  const descriptor = findContracts(readerType, name, false)[0];
  assert(descriptor, 'Missing reader contract: ' + name);
  return descriptor;
}

/** Real platform dispatch; the reader handle roots its source until the test stops its VM. */
export function readerPlatform(engine, text = 'first\r\nlast') {
  emptyProgram ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(emptyProgram.success, true, JSON.stringify(emptyProgram.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(emptyProgram.image) : new CilVirtualMachine(emptyProgram.assembly);
  const platform = vm.platform;
  const input = platform.managed(text, 'string');
  const reference = platform.invoke(readerContract('.ctor'), [input]);
  const root = platform.heap.createHandle(reference);
  const call = name => platform.invoke(readerContract(name), [reference]);
  return {vm, platform, input, reference, call, stop() { platform.heap.releaseHandle(root); vm.stop(); }};
}

/** Emit ordinary CIL directly, including base dispatch and interface casts absent from the source profile. */
export function readerAssembly({method = 'Read', disposed = false, nullInput = false, nullReceiver = false} = {}) {
  const result = ['Peek', 'Read'].includes(method) ? 'int' : 'string';
  return managedFixture({methods: [{name: 'Main', result, body(writer, context) {
    if (nullReceiver) writer.op('ldnull');
    else {
      if (nullInput) writer.op('ldnull');
      else writer.op('ldstr', 0x70000000 + context.md.userString(''));
      writer.op('newobj', context.member(readerType, '.ctor', 'void', ['string'], false));
      writer.op('castclass', context.resolve(parentType));
    }
    if (disposed) writer.op('dup').op('callvirt', context.member(parentType, 'Dispose', 'void', [], false));
    writer.op('callvirt', context.member(parentType, method, result, [], false)).op('ret');
  }}]});
}

export function readerBaseAssembly() {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: [parentType], body(writer, context) {
    writer.op('ldstr', 0x70000000 + context.md.userString('base'));
    writer.op('newobj', context.member(readerType, '.ctor', 'void', ['string'], false));
    writer.op('castclass', context.resolve(parentType)).op('stloc.0').op('ldloc.0');
    writer.op('callvirt', context.member(parentType, 'ReadLine', 'string', [], false));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
    writer.op('ldloc.0').op('isinst', context.resolve('System.IDisposable')).op('ldnull').op('cgt.un');
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['bool']));
    writer.op('ldloc.0').op('callvirt', context.member(parentType, 'Dispose', 'void', [], false));
    writer.op('ldloc.0').op('callvirt', context.member(parentType, 'Read', 'int', [], false)).op('ret');
  }}]});
}

/** Preserve the explicit CIL guard for the separate external IDisposable dispatch prerequisite. */
export function readerInterfaceDisposeAssembly() {
  return managedFixture({methods: [{name: 'Main', result: 'void', body(writer, context) {
    writer.op('ldstr', 0x70000000 + context.md.userString(''));
    writer.op('newobj', context.member(readerType, '.ctor', 'void', ['string'], false));
    writer.op('castclass', context.resolve('System.IDisposable'));
    writer.op('callvirt', context.member('System.IDisposable', 'Dispose', 'void', [], false)).op('ret');
  }}]});
}
