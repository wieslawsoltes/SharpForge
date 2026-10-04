import {
  MetadataBuilder, Writer, CilWriter, methodSignature, codedIndex, token, writePE, TEXT_RVA
} from '@sharpforge/cil';

/** Independent CLI metadata with one shared call site and several implementation types. */
export function inlineCacheFixture(sequence = [0, 0, 0, 0], {interfaceCall = false, delta = 0, byteArgument = null} = {}) {
  const constructor = base => ({name: '.ctor', result: 'void', flags: 0x1886,
    body: (writer, context) => writer.op('ldarg.0').op('call',
      base ? context.methods.get(base + '..ctor') : context.objectConstructor).op('ret')});
  const types = [{name: 'Base', interface: interfaceCall, methods: [
    ...(interfaceCall ? [] : [constructor()]),
    {name: 'Value', flags: interfaceCall ? 0x5c6 : 0x1c6, parameters: byteArgument === null ? [] : ['byte'],
      ...(interfaceCall ? {} : {body: writer => writer.op('ldc.i4.0').op('ret')})}
  ]}];
  const count = Math.max(6, ...sequence.map(index => index + 1));
  for (let index = 0; index < count; index++) types.push({name: 'Receiver' + index,
    base: interfaceCall ? null : 'Base', methods: [constructor(interfaceCall ? null : 'Base'),
      {name: 'Value', flags: interfaceCall ? 0x1c6 : 0xc6, parameters: byteArgument === null ? [] : ['byte'],
        body: writer => (byteArgument === null ? writer.op('ldc.i4', index + 1 + delta) : writer.op('ldarg.1')).op('ret')}]
  });
  types.push({name: 'Program', methods: [
    {name: 'Main', flags: 0x96, body(writer, context) {
      writer.op('ldc.i4.0');
      for (const index of sequence) writer.op('newobj', context.methods.get('Receiver' + index + '..ctor'))
        .op('call', context.methods.get('Program.Invoke')).op('add');
      writer.op('ret');
    }},
    {name: 'Invoke', flags: 0x96, parameters: ['Base'], body(writer, context) {
      writer.op('ldarg.0');
      if (byteArgument !== null) writer.op('ldc.i4', byteArgument);
      writer.op('callvirt', context.methods.get('Base.Value')).op('ret');
    }}
  ]});
  const metadata = new MetadataBuilder('InlineCache');
  const typeTokens = new Map(types.map((type, index) => [type.name, token(2, index + 2)]));
  const resolve = name => typeTokens.get(name) ?? metadata.typeRef(name);
  const object = resolve('System.Object');
  const methods = new Map();
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  let nextMethod = 1;
  for (const type of types) {
    metadata.add(2, [type.interface ? 0xa1 : 0x100001, metadata.string(type.name), 0,
      type.interface ? 0 : codedIndex('TypeDefOrRef', type.base ? resolve(type.base) : object), 1, nextMethod]);
    for (const method of type.methods) methods.set(type.name + '.' + method.name, token(6, nextMethod++));
    if (interfaceCall && type.name.startsWith('Receiver')) {
      metadata.add(9, [typeTokens.get(type.name) & 0xffffff, codedIndex('TypeDefOrRef', typeTokens.get('Base'))]);
    }
  }
  const definitions = types.flatMap(type => type.methods);
  for (const method of definitions) metadata.add(6, [0, 0, method.flags, metadata.string(method.name),
    metadata.blob(methodSignature(method.result ?? 'int', method.parameters ?? [], !!(method.flags & 0x10), resolve)), 1]);
  const context = {methods, objectConstructor: metadata.member(object, '.ctor', methodSignature('void', [], false, resolve))};
  const section = new Writer().zero(72);
  definitions.forEach((method, index) => {
    if (!method.body) return;
    const writer = new CilWriter();
    method.body(writer, context);
    const code = writer.finish();
    section.pad(4);
    metadata.rows[6][index][0] = TEXT_RVA + section.length;
    section.u16(0x3013).u16(8).u32(code.length).u32(0).bytes(code);
  });
  section.pad(4);
  const offset = section.length;
  const bytes = metadata.finish(undefined, new Uint8Array([3, 7, 2]));
  section.bytes(bytes);
  return writePE(section.finish(), offset, bytes.length, methods.get('Program.Main'));
}
