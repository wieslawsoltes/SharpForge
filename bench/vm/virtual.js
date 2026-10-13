import {MetadataBuilder, Writer, CilWriter, methodSignature, localSignature, codedIndex, token, writePE, TEXT_RVA}
  from '@sharpforge/cil';

/** Genuine override dispatch, assembled through the public CIL API; not a native .NET qualification artifact. */
export function virtualAssembly(iterations) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000000) {
    throw new RangeError('Virtual dispatch iterations must be between 1 and 1000000');
  }
  const metadata = new MetadataBuilder('VirtualBenchmark');
  const object = metadata.typeRef('System.Object');
  const base = token(2, 2), derived = token(2, 3);
  const resolve = name => name === 'Base' ? base : name === 'Derived' ? derived : metadata.typeRef(name);
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  metadata.add(2, [0x100001, metadata.string('Base'), 0, codedIndex('TypeDefOrRef', object), 1, 1]);
  metadata.add(2, [0x100001, metadata.string('Derived'), 0, codedIndex('TypeDefOrRef', base), 1, 3]);
  metadata.add(2, [0x100001, metadata.string('Program'), 0, codedIndex('TypeDefOrRef', object), 1, 5]);
  const objectConstructor = metadata.member(object, '.ctor', methodSignature('void', [], false, resolve));
  const methods = [
    {name: '.ctor', flags: 0x1886, body: writer => writer.op('ldarg.0').op('call', objectConstructor).op('ret')},
    {name: 'Value', flags: 0x1c6, result: 'int', body: writer => writer.op('ldc.i4.0').op('ret')},
    {name: '.ctor', flags: 0x1886, body: writer => writer.op('ldarg.0').op('call', token(6, 1)).op('ret')},
    {name: 'Value', flags: 0xc6, result: 'int', body: writer => writer.op('ldc.i4.7').op('ret')},
    {name: 'Main', flags: 0x96, result: 'int', static: true, locals: ['Base', 'int', 'int'], body(writer) {
      writer.op('newobj', token(6, 3)).op('stloc.0').op('ldc.i4.0').op('stloc.1').op('ldc.i4.0').op('stloc.2');
      writer.mark('loop');
      writer.op('ldloc.2').op('ldloc.0').op('callvirt', token(6, 2)).op('add').op('stloc.2');
      writer.op('ldloc.1').op('ldc.i4.1').op('add').op('stloc.1');
      writer.op('ldloc.1').op('ldc.i4', iterations).op('blt', 'loop').op('ldloc.2').op('ret');
    }},
  ];
  const section = new Writer().zero(72);
  for (const method of methods) {
    const signature = methodSignature(method.result ?? 'void', [], !!method.static, resolve);
    const row = metadata.add(6, [0, 0, method.flags, metadata.string(method.name), metadata.blob(signature), 1]);
    const writer = new CilWriter();
    method.body(writer);
    const code = writer.finish();
    const locals = method.locals ? metadata.add(17, [metadata.blob(localSignature(method.locals, resolve))]) : 0;
    section.pad(4);
    metadata.rows[6][(row & 0xffffff) - 1][0] = TEXT_RVA + section.length;
    section.u16(0x3013).u16(3).u32(code.length).u32(locals).bytes(code);
  }
  section.pad(4);
  const offset = section.length, bytes = metadata.finish(undefined, new Uint8Array([0xa0, 5, 12]));
  section.bytes(bytes);
  return writePE(section.finish(), offset, bytes.length, token(6, 5));
}
