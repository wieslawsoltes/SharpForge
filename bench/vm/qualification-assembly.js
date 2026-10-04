import {MetadataBuilder, Writer, CilWriter, methodSignature, localSignature, codedIndex, writePE, TEXT_RVA}
  from '@sharpforge/cil';

/** Single verified method assembled only through public ECMA-335 metadata/IL APIs. */
export function qualificationAssembly({name = 'Qualification', parameters = [], result = 'int', locals = [], maxStack = 2, body}) {
  const metadata = new MetadataBuilder(name);
  const resolve = type => metadata.typeRef(type);
  const object = metadata.typeRef('System.Object');
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  metadata.add(2, [0x100001, metadata.string('Program'), metadata.string('Qualification'),
    codedIndex('TypeDefOrRef', object), 1, 1]);
  for (let index = 0; index < parameters.length; index++) {
    metadata.add(8, [0, index + 1, metadata.string('argument' + index)]);
  }
  const method = metadata.add(6, [0, 0, 0x96, metadata.string('Main'),
    metadata.blob(methodSignature(result, parameters, true, resolve)), 1]);
  const instructions = new CilWriter();
  body(instructions, {resolve});
  const code = instructions.finish();
  const signature = locals.length ? metadata.add(17, [metadata.blob(localSignature(locals, resolve))]) : 0;
  const section = new Writer().zero(72);
  metadata.rows[6][0][0] = TEXT_RVA + section.length;
  section.u16(0x3013).u16(maxStack).u32(code.length).u32(signature).bytes(code).pad(4);
  const offset = section.length;
  const bytes = metadata.finish(undefined, new Uint8Array([0xa0, 0x05, 0x12]));
  section.bytes(bytes);
  return writePE(section.finish(), offset, bytes.length, method);
}

export function arithmeticAssembly(operation, width) {
  const type = width === 32 ? 'int' : 'long';
  const unary = operation === 'neg' || operation === 'not';
  const comparison = ['ceq', 'clt', 'clt.un', 'cgt', 'cgt.un'].includes(operation);
  return qualificationAssembly({name: 'Differential_' + width + '_' + operation.replaceAll('.', '_'),
    parameters: unary ? [type] : [type, type], result: comparison ? 'int' : type,
    body(writer) {
      writer.op('ldarg.0');
      if (!unary) writer.op('ldarg.1');
      writer.op(operation).op('ret');
    }});
}
