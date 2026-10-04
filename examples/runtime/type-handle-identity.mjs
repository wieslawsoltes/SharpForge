import assert from 'node:assert/strict';
import {MetadataBuilder, Writer, CilWriter, methodSignature, codedIndex, writePE, TEXT_RVA} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';

const metadata = new MetadataBuilder('TypeHandleIdentity');
const resolve = name => metadata.typeRef(name);
const object = resolve('System.Object');
metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
metadata.add(2, [0x100001, metadata.string('Program'), 0, codedIndex('TypeDefOrRef', object), 1, 1]);
const member = (owner, name, result, parameters = [], isStatic = true) =>
  metadata.member(resolve(owner), name, methodSignature(result, parameters, isStatic, resolve));
const entry = metadata.add(6, [0, 0, 0x96, metadata.string('Main'),
  metadata.blob(methodSignature('void', [], true, resolve)), 1]);
const fromHandle = member('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']);
const isDefinition = member('System.Type', 'get_IsGenericTypeDefinition', 'bool', [], false);
const print = member('System.Console', 'WriteLine', 'void', ['bool']);
const writer = new CilWriter();
for (const name of ['System.Int32', 'System.Collections.Generic.List`1']) {
  writer.op('ldtoken', resolve(name)).op('call', fromHandle).op('callvirt', isDefinition).op('call', print);
}
const code = writer.op('ret').finish();
const section = new Writer().zero(72);
metadata.rows[6][0][0] = TEXT_RVA + section.length;
section.u16(0x3013).u16(1).u32(code.length).u32(0).bytes(code).pad(4);
const offset = section.length;
const tables = metadata.finish(undefined, new Uint8Array([7, 2, 4]));
section.bytes(tables);

const vm = new CilVirtualMachine(writePE(section.finish(), offset, tables.length, entry));
try {
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.output, 'False\nTrue\n');
  process.stdout.write(result.output);
} finally { vm.stop(); }
