import assert from 'node:assert/strict';
import {findContracts} from '@sharpforge/framework';
import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';
import {sourceImage} from '../a07/legacy-builtin-engines.js';
import {readerType, parentType} from './engines.js';

export const sliceParameters = ['char[]', 'int', 'int'];
export const decodeUnits = units => String.fromCharCode(...units);

export function bufferContract(name, parameters = sliceParameters) {
  const result = findContracts(readerType, name, false)
    .find(row => JSON.stringify(row.parameters) === JSON.stringify(parameters));
  assert(result, `${readerType}.${name}(${parameters})`);
  return result;
}

function sourceReader(row) {
  const read = frameworkBuiltin(bufferContract(row.method));
  const image = sourceImage({name: read.name, args: [], result: 'int'});
  const code = [];
  const emit = (op, first = 0, second = 0) => code.push(op, first, second);
  const constant = value => { const index = image.constants.push(value) - 1; emit(Op.CONST, index); };
  const call = (name, parameters, count) => emit(Op.BUILTIN, frameworkBuiltin(bufferContract(name, parameters)).id, count);
  constant(row.nullReader ? null : decodeUnits(row.sourceUnits));
  if (!row.nullReader) call('.ctor', ['string'], 1);
  emit(Op.STSTATIC, 0);
  emit(Op.POP);
  for (let index = 0; index < row.start; index++) {
    emit(Op.LDSTATIC, 0);
    call('Read', [], 1);
    emit(Op.POP);
  }
  if (row.disposed) {
    emit(Op.LDSTATIC, 0);
    call('Dispose', [], 1);
    emit(Op.POP);
  }
  if (row.nullBuffer) constant(null);
  else {
    constant(row.bufferLength);
    emit(Op.NEWARR, image.constants.push('char') - 1);
  }
  emit(Op.STSTATIC, 1);
  emit(Op.POP);
  if (!row.nullBuffer) {
    for (let index = 0; index < row.bufferLength; index++) {
      emit(Op.LDSTATIC, 1);
      constant(index);
      constant(46);
      emit(Op.STELEM);
      emit(Op.POP);
    }
  }
  emit(Op.LDSTATIC, 0);
  emit(Op.LDSTATIC, 1);
  constant(row.index);
  constant(row.count);
  emit(Op.BUILTIN, read.id, 4);
  emit(Op.RET);
  image.statics = [{name: 'Reader', type: parentType, value: null}, {name: 'Buffer', type: 'char[]', value: null}];
  image.methods[0].code = Int32Array.from(code);
  return new VirtualMachine(image);
}

function readerAssembly(row) {
  return managedFixture({
    fields: [{name: 'Reader', type: parentType}, {name: 'Buffer', type: 'char[]'}],
    methods: [{name: 'Main', result: 'int', maxStack: 4, body(writer, context) {
      const reader = 0x04000000 | context.fields.Reader;
      const buffer = 0x04000000 | context.fields.Buffer;
      const call = (name, result, parameters = []) =>
        writer.op('callvirt', context.member(parentType, name, result, parameters, false));
      if (row.nullReader) writer.op('ldnull');
      else {
        writer.op('ldstr', 0x70000000 + context.md.userString(decodeUnits(row.sourceUnits)));
        writer.op('newobj', context.member(readerType, '.ctor', 'void', ['string'], false));
        writer.op('castclass', context.resolve(parentType));
      }
      writer.op('stsfld', reader);
      for (let index = 0; index < row.start; index++) {
        writer.op('ldsfld', reader);
        call('Read', 'int');
        writer.op('pop');
      }
      if (row.disposed) {
        writer.op('ldsfld', reader);
        call('Dispose', 'void');
      }
      if (row.nullBuffer) writer.op('ldnull');
      else writer.op('ldc.i4', row.bufferLength).op('newarr', context.resolve('System.Char'));
      writer.op('stsfld', buffer);
      if (!row.nullBuffer) {
        for (let index = 0; index < row.bufferLength; index++) {
          writer.op('ldsfld', buffer).op('ldc.i4', index).op('ldc.i4', 46).op('stelem.i2');
        }
      }
      writer.op('ldsfld', reader).op('ldsfld', buffer).op('ldc.i4', row.index).op('ldc.i4', row.count);
      call(row.method, 'int', sliceParameters);
      writer.op('ret');
    }}]
  });
}

/** Execute real source bytecode or independently assembled CIL, without enabling source Char syntax. */
export function bufferReader(engine, row) {
  const vm = engine === 'source' ? sourceReader(row) : new CilVirtualMachine(readerAssembly(row));
  return {
    vm,
    reader: () => engine === 'source' ? vm.statics[0] : vm.statics.get(0x04000001),
    buffer: () => engine === 'source' ? vm.statics[1] : vm.statics.get(0x04000002)
  };
}
