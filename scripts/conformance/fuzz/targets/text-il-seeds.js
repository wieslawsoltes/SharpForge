import {
  CilWriter, MetadataBuilder, Writer, TEXT_RVA, codedIndex, formatILDocument,
  methodSignature, writeMethodBody, writePE,
} from '@sharpforge/cil';

function documentSeed(name, returnType, createCode) {
  const metadata = new MetadataBuilder(name);
  const objectType = metadata.typeRef('System.Object');
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  metadata.add(2, [0x100001, metadata.string('Seed'), 0, codedIndex('TypeDefOrRef', objectType), 1, 1]);
  const code = createCode(metadata);
  const section = new Writer().zero(72);
  const signature = metadata.blob(methodSignature(returnType, [], true));
  metadata.add(6, [TEXT_RVA + section.length, 0, 0x96, metadata.string('Value'), signature, 1]);
  section.bytes(writeMethodBody(code, 0, 1, [])).pad(4);
  const offset = section.length;
  const encoded = metadata.finish(undefined, new Uint8Array([11, 7, 3]));
  section.bytes(encoded);
  const bytes = writePE(section.finish(), offset, encoded.length, 0, { outputKind: 'library', deterministic: true });
  return formatILDocument(bytes);
}

/** Build a tiny local library for IL parsing and the DAP target's fixed, bounded execution. */
export function createILDocumentSeed() {
  return documentSeed('TextFuzzSeed', 'string', metadata => {
    const literal = 0x70000000 + metadata.userString('small seed');
    return new CilWriter().op('br.s', 'value').op('nop').mark('value').op('ldstr', literal).op('ret').finish();
  });
}

/** Small authored floating fixtures exercise exact sign and payload retention without execution. */
export function createILFloatingDocumentSeeds() {
  return [
    { name: 'floating-negative-zero', document: documentSeed('TextNegativeZero', 'double', () =>
      new CilWriter().op('ldc.r8', -0).op('ret').finish()) },
    { name: 'floating-nan-payload', document: documentSeed('TextNaNPayload', 'double', () => {
      const writer = new CilWriter().op('ldc.r8', NaN).op('ret');
      writer.patch32(1, 0x1234);
      writer.patch32(5, 0x7ff00000);
      return writer.finish();
    }) },
  ];
}
