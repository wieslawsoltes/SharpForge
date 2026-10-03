import {
  MetadataBuilder, parseSignatureType, encodeTypeSignature, decodeTypeSignature,
  propertySignature, readSignature,
} from '@sharpforge/cil';

const metadata = new MetadataBuilder('SignatureExample');
const type = parseSignatureType('Dictionary<string, List<int>>', name => metadata.typeRef(name));
const bytes = encodeTypeSignature(type);
console.log('Nested generic signature:', Array.from(bytes));
console.log('Lossless type:', decodeTypeSignature(bytes));
console.log('Indexer:', readSignature(propertySignature('string', ['int'], false)));
