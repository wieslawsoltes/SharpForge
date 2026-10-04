import { MetadataBuilder, CilWriter, Writer, methodSignature, localSignature, writeMethodBody, writePE } from '@sharpforge/cil';

/** Hand-authored executable CIL; offsets come from the existing label writer, not the EH encoder. */
export function exceptionFixture({ kind = 'filter', exceptionFormat = 'fat', nativeChained = false, name = 'ExceptionFixture' } = {}) {
  const metadata = new MetadataBuilder(name);
  const object = metadata.typeRef('System.Object');
  const exception = metadata.typeRef('System.Exception');
  metadata.definitions.typeDef({ Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  metadata.definitions.typeDef({ Flags: 1, Name: 'Cases', Namespace: '', Extends: object, FieldList: 1, MethodList: 1 });
  const localToken = metadata.add(17, [metadata.blob(localSignature(['int']))]);
  const writer = new CilWriter().integer(0).local('stloc', 0).mark('try').op('ldnull').op('throw').mark('tryEnd');
  if (kind === 'filter') {
    writer.mark('filter').op('pop').integer(1).op('endfilter').mark('handler')
      .op('pop').integer(42).local('stloc', 0).op('leave', 'done');
  } else {
    writer.mark('fault').integer(7).local('stloc', 0).op('endfinally').mark('faultEnd')
      .mark('handler').op('pop').op('leave', 'done');
  }
  writer.mark('done').local('ldloc', 0).op('ret');
  const at = name => writer.labels.get(name);
  const handlers = kind === 'filter'
    ? [{ flags: 1, start: at('try'), end: at('tryEnd'), filterOffset: at('filter'), target: at('handler'), handlerEnd: at('done') }]
    : [{ flags: 4, start: at('try'), end: at('tryEnd'), target: at('fault'), handlerEnd: at('faultEnd') },
      { flags: 0, start: at('try'), end: at('handler'), target: at('handler'), handlerEnd: at('done'), catchType: exception }];
  const code = writer.finish();
  let body = writeMethodBody(code, localToken, 1, handlers, { exceptionFormat });
  if (nativeChained) {
    // Negative interoperability fixture only: native SRM/CoreCLR consume just the first EH section.
    const offset = (12 + code.length + 3) & ~3;
    body = new Writer().bytes(body.subarray(0, offset)).u8(0x81).u8(16).u16(0)
      .bytes(body.subarray(offset + 4, offset + 16)).u8(1).u8(16).u16(0).bytes(body.subarray(offset + 16)).finish();
  }
  const section = new Writer().zero(72).bytes(body).pad();
  const methodToken = metadata.definitions.method({ RVA: 0x2048, ImplFlags: 0, Flags: 0x96,
    Name: 'Run', Signature: methodSignature('int', [], true), ParamList: 1 });
  const metadataOffset = section.length;
  const metadataBytes = metadata.finish();
  section.bytes(metadataBytes);
  return { assembly: writePE(section.finish(), metadataOffset, metadataBytes.length, 0, { outputKind: 'library' }),
    body, code, handlers, methodToken, expected: kind === 'filter' ? 42 : 7 };
}
