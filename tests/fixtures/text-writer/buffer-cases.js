import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';
import {sourceImage} from '../a07/legacy-builtin-engines.js';
import {writerContract, writerType, parentType} from './engines.js';

const fullParameters = ['char[]'];
const sliceParameters = ['char[]', 'int', 'int'];
const newline = row => row.newLine === null ? null : String.fromCharCode(...row.newLine);

/** Actual source-bytecode calls with rooted static writer/buffer fields, independent of source lowering. */
export function sourceBufferWriter(row, name = 'Write') {
  const image = sourceImage({name: frameworkBuiltin(writerContract(name, row.full ? fullParameters : sliceParameters)).name,
    args: [], result: 'void'});
  const code = [];
  const emit = (op, first = 0, second = 0) => code.push(op, first, second);
  const constant = value => emit(Op.CONST, image.constants.push(value) - 1);
  const call = (member, parameters, count) => emit(Op.BUILTIN, frameworkBuiltin(writerContract(member, parameters)).id, count);
  if (row.nullWriter) constant(null);
  else call('.ctor', [], 0);
  emit(Op.STSTATIC, 0);
  emit(Op.POP);
  if (!row.nullWriter) {
    emit(Op.LDSTATIC, 0);
    constant('seed|');
    call('Write', ['string'], 2);
    emit(Op.POP);
    if (row.setNewLine) {
      emit(Op.LDSTATIC, 0);
      constant(newline(row));
      call('set_NewLine', ['string'], 2);
      emit(Op.POP);
    }
  }
  if (row.disposed) {
    emit(Op.LDSTATIC, 0);
    call('Dispose', [], 1);
    emit(Op.POP);
  }
  if (row.input === null) constant(null);
  else {
    constant(row.input.length);
    emit(Op.NEWARR, image.constants.push('char') - 1);
  }
  emit(Op.STSTATIC, 1);
  emit(Op.POP);
  row.input?.forEach((value, index) => {
    emit(Op.LDSTATIC, 1);
    constant(index);
    constant(value);
    emit(Op.STELEM);
    emit(Op.POP);
  });
  emit(Op.LDSTATIC, 0);
  emit(Op.LDSTATIC, 1);
  if (!row.full) {
    constant(row.index);
    constant(row.count);
  }
  call(name, row.full ? fullParameters : sliceParameters, row.full ? 2 : 4);
  emit(Op.RET);
  image.statics = [{name: 'Writer', type: row.baseView ? parentType : writerType, value: null},
    {name: 'Buffer', type: 'char[]', value: null}];
  image.methods[0].code = Int32Array.from(code);
  return new VirtualMachine(image);
}

/** Independent callvirt through the actual declared writer/base owner and real char-array IL. */
export function bufferWriterAssembly(row, name = 'Write') {
  const owner = row.baseView ? parentType : writerType;
  return managedFixture({fields: [{name: 'Writer', type: owner}, {name: 'Buffer', type: 'char[]'}],
    methods: [{name: 'Main', result: 'void', maxStack: 4, body(writer, context) {
      const writerField = 0x04000000 | context.fields.Writer;
      const buffer = 0x04000000 | context.fields.Buffer;
      const call = (member, parameters = []) => writer.op('callvirt', context.member(owner, member, 'void', parameters, false));
      if (row.nullWriter) writer.op('ldnull');
      else writer.op('newobj', context.member(writerType, '.ctor', 'void', [], false)).op('castclass', context.resolve(owner));
      writer.op('stsfld', writerField);
      if (!row.nullWriter) {
        writer.op('ldsfld', writerField).op('ldstr', 0x70000000 + context.md.userString('seed|'));
        call('Write', ['string']);
        if (row.setNewLine) {
          writer.op('ldsfld', writerField);
          if (row.newLine === null) writer.op('ldnull');
          else writer.op('ldstr', 0x70000000 + context.md.userString(newline(row)));
          call('set_NewLine', ['string']);
        }
      }
      if (row.disposed) {
        writer.op('ldsfld', writerField);
        call('Dispose');
      }
      if (row.input === null) writer.op('ldnull');
      else writer.op('ldc.i4', row.input.length).op('newarr', context.resolve('System.Char'));
      writer.op('stsfld', buffer);
      row.input?.forEach((value, index) => writer.op('ldsfld', buffer).op('ldc.i4', index).op('ldc.i4', value).op('stelem.i2'));
      writer.op('ldsfld', writerField).op('ldsfld', buffer);
      if (!row.full) writer.op('ldc.i4', row.index).op('ldc.i4', row.count);
      call(name, row.full ? fullParameters : sliceParameters);
      writer.op('ret');
    }}]});
}
