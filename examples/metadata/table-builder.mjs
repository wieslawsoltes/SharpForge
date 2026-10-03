import { MetadataBuilder, TypeAttributes, readMetadata, validateMetadata } from '@sharpforge/cil';

const builder = new MetadataBuilder('MetadataExample');
builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
const type = builder.definitions.typeDef({ Flags: TypeAttributes.Public, Name: 'Example', Namespace: 'Demo',
  Extends: builder.typeRef('System.Object'), FieldList: 1, MethodList: 1 });
const child = builder.definitions.typeDef({ Flags: TypeAttributes.NestedPublic, Name: 'Nested', Namespace: '',
  Extends: builder.typeRef('System.Object'), FieldList: 1, MethodList: 1 });
builder.definitions.nestedClass({ NestedClass: child, EnclosingClass: type });
const metadata = readMetadata(builder.finish());
console.log(metadata.typeName(child));
console.log(validateMetadata(metadata));
